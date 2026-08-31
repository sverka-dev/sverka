import type { Plan } from "./plan.js";
import { computePlanId } from "./ids.js";
import { findCycle } from "./graph.js";

/** A single validation failure. */
export interface ValidationErrorDetail {
  readonly operationId?: string;
  readonly field: string;
  readonly message: string;
  readonly code: string;
}

/** The outcome of validating a candidate Plan. */
export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ValidationErrorDetail[];
}

/** A validator object wrapping {@link validatePlan}. */
export interface PlanValidator {
  validate(plan: unknown): ValidationResult;
}

const NETWORK_POLICIES = new Set(["deny", "allow-host", "allow-egress"]);
const RETRY_ON_VALUES = new Set(["failure", "timeout"]);
const GENERATED_BY_VALUES = new Set(["planner", "manual", "compiler"]);
const MEMORY_SUFFIXES = new Set(["Ki", "Mi", "Gi", "Ti"]);
const OPERATION_KINDS = new Set(["run", "check", "build", "analyze", "fetch", "publish", "custom"]);

/** Validate sha256 image digest without regex (avoids ReDoS false positive). */
function isValidImageDigest(s: string): boolean {
  if (s.length !== 71) return false; // "sha256:" + 64 hex chars
  if (!s.startsWith("sha256:")) return false;
  for (let i = 7; i < s.length; i++) {
    const c = s.codePointAt(i) ?? -1;
    const isHex = (c >= 48 && c <= 57) || (c >= 97 && c <= 102); // 0-9, a-f
    if (!isHex) return false;
  }
  return true;
}

/** Validate CPU string (digits with optional decimal) without regex. */
function isValidCpuString(s: string): boolean {
  if (s.length === 0 || s.length > 10) return false;
  let hasDot = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.codePointAt(i) ?? -1;
    if (c === 46) { // '.'
      if (hasDot || i === 0 || i === s.length - 1) return false;
      hasDot = true;
    } else if (c < 48 || c > 57) { // not '0'-'9'
      return false;
    }
  }
  return true;
}

/** Find the boundary between digit and suffix portions (from the right). */
function findDigitBoundary(s: string): number {
  for (let i = s.length - 1; i >= 0; i--) {
    const c = s.codePointAt(i) ?? -1;
    if (c >= 48 && c <= 57) return i + 1; // '0'-'9'
  }
  return 0;
}

/** Check if all chars in s[start..end) are ASCII digits. */
function isAllDigits(s: string, start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    const c = s.codePointAt(i) ?? -1;
    if (c < 48 || c > 57) return false;
  }
  return true;
}

/** Validate memory string (digits with optional suffix) without regex. */
function isValidMemoryString(s: string): boolean {
  if (s.length === 0 || s.length > 20) return false;
  const digitEnd = findDigitBoundary(s);
  if (digitEnd === 0) return false; // no digits at all
  if (!isAllDigits(s, 0, digitEnd)) return false;
  if (digitEnd < s.length) {
    const suffix = s.slice(digitEnd);
    if (!MEMORY_SUFFIXES.has(suffix)) return false;
  }
  return true;
}

/**
 * Validate an unknown value as a Plan. Returns a {@link ValidationResult};
 * never throws. Collects all detectable errors (does not short-circuit) so
 * callers get the full picture.
 */
export function validatePlan(plan: unknown): ValidationResult {
  const errors: ValidationErrorDetail[] = [];

  if (!isPlainObject(plan) || Array.isArray(plan)) {
    errors.push({ field: "", code: "INVALID_PLAN", message: "plan must be a plain object" });
    return { valid: false, errors };
  }

  const p = plan as Record<string, unknown>;
  validateTopLevel(p, errors);

  if (isPlainObject(p.metadata)) {
    validateMetadata(p.metadata as Record<string, unknown>, errors);
  } else {
    errors.push({ field: "metadata", code: "INVALID_METADATA", message: "metadata must be an object" });
  }

  if (!Array.isArray(p.operations)) {
    errors.push({ field: "operations", code: "EMPTY_OPERATIONS", message: "operations must be a non-empty array" });
    return { valid: errors.length === 0, errors };
  }

  const operations = p.operations as readonly unknown[];
  if (operations.length === 0) {
    errors.push({ field: "operations", code: "EMPTY_OPERATIONS", message: "operations must be non-empty" });
    return { valid: errors.length === 0, errors };
  }

  const ops = normalizeOperations(operations, errors);
  if (ops.length === 0) return { valid: errors.length === 0, errors };

  const { idSet, idCounts } = collectOperationIds(ops);
  detectDuplicateIds(ops, idCounts, errors);

  for (const op of ops) {
    validateOperation(op, idSet, errors);
  }

  validateAcyclic(ops, errors);

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Top-level validation
// ---------------------------------------------------------------------------

/** Validate top-level plan fields: apiVersion, id, structural shape, id recompute. */
function validateTopLevel(p: Record<string, unknown>, errors: ValidationErrorDetail[]): void {
  const apiVersionOk = validateApiVersion(p, errors);
  const idOk = validatePlanId(p, errors);
  const nameOk = validateName(p, errors);
  const sourceContextHashOk = validateSourceContextHash(p, errors);
  const createdAtOk = validateCreatedAt(p, errors);

  const shapeOk =
    apiVersionOk &&
    nameOk &&
    sourceContextHashOk &&
    createdAtOk &&
    Array.isArray(p.operations) &&
    isPlainObject(p.metadata);

  if (shapeOk && idOk) {
    recomputeId(p, errors);
  }
}

function validateApiVersion(p: Record<string, unknown>, errors: ValidationErrorDetail[]): boolean {
  if (p.apiVersion !== "sverka.dev/v1") {
    errors.push({ field: "apiVersion", code: "INVALID_API_VERSION", message: `apiVersion must be "sverka.dev/v1"` });
    return false;
  }
  return true;
}

function validatePlanId(p: Record<string, unknown>, errors: ValidationErrorDetail[]): boolean {
  const ok = typeof p.id === "string" && p.id.length > 0;
  if (!ok) {
    errors.push({ field: "id", code: "ID_MISMATCH", message: "id must be a non-empty string matching computePlanId" });
  }
  return ok;
}

function validateName(p: Record<string, unknown>, errors: ValidationErrorDetail[]): boolean {
  const ok = typeof p.name === "string" && p.name.length > 0;
  if (!ok) {
    errors.push({ field: "name", code: "INVALID_PLAN", message: "name must be a non-empty string" });
  }
  return ok;
}

function validateSourceContextHash(p: Record<string, unknown>, errors: ValidationErrorDetail[]): boolean {
  const ok = typeof p.sourceContextHash === "string" && p.sourceContextHash.length > 0;
  if (!ok) {
    errors.push({ field: "sourceContextHash", code: "INVALID_PLAN", message: "sourceContextHash must be a non-empty string" });
  }
  return ok;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const ISO_FRACTION_RE = /^\.\d+/;
const ISO_TZ_RE = /^(Z|[+-]\d{2}:?\d{2})$/;

function isValidIso8601(s: string): boolean {
  if (ISO_DATE_RE.test(s)) return !Number.isNaN(Date.parse(s));
  const m = ISO_DATETIME_RE.exec(s);
  if (!m) return false;
  const rest = s.slice(m[0].length);
  let offset = 0;
  if (rest.startsWith(".")) {
    const fm = ISO_FRACTION_RE.exec(rest);
    if (!fm) return false;
    offset = fm[0].length;
  }
  const tz = rest.slice(offset);
  if (tz === "") return !Number.isNaN(Date.parse(s));
  return ISO_TZ_RE.test(tz) && !Number.isNaN(Date.parse(s));
}

function validateCreatedAt(p: Record<string, unknown>, errors: ValidationErrorDetail[]): boolean {
  const ok = typeof p.createdAt === "string" && p.createdAt.length > 0 && isValidIso8601(p.createdAt);
  if (!ok) {
    errors.push({ field: "createdAt", code: "INVALID_PLAN", message: "createdAt must be a non-empty ISO 8601 string" });
  }
  return ok;
}

/** Recompute the plan id and compare with the declared id. */
function recomputeId(p: Record<string, unknown>, errors: ValidationErrorDetail[]): void {
  try {
    const { id: _id, createdAt: _createdAt, ...body } = p;
    const expected = computePlanId(body as Omit<Plan, "id" | "createdAt">);
    if (expected !== p.id) {
      errors.push({ field: "id", code: "ID_MISMATCH", message: `id does not match recomputed plan id (expected ${expected})` });
    }
  } catch {
    errors.push({ field: "id", code: "ID_MISMATCH", message: "could not recompute plan id" });
  }
}

/** Normalize operations array into typed views, rejecting non-object entries. */
function normalizeOperations(operations: readonly unknown[], errors: ValidationErrorDetail[]): PlanOperationView[] {
  const ops: PlanOperationView[] = [];
  for (let i = 0; i < operations.length; i++) {
    const raw = operations[i];
    if (!isPlainObject(raw)) {
      errors.push({ field: "operations[]", code: "INVALID_OPERATION", message: `operations[${i}] must be a plain object` });
      continue;
    }
    ops.push(raw as PlanOperationView);
  }
  return ops;
}

/** Collect operation ids into a set and a count map. */
function collectOperationIds(ops: readonly PlanOperationView[]): { idSet: Set<string>; idCounts: Map<string, number> } {
  const idSet = new Set<string>();
  const idCounts = new Map<string, number>();
  for (const op of ops) {
    if (typeof op.id === "string") {
      idSet.add(op.id);
      idCounts.set(op.id, (idCounts.get(op.id) ?? 0) + 1);
    }
  }
  return { idSet, idCounts };
}

/** Detect and report duplicate operation ids. */
function detectDuplicateIds(ops: readonly PlanOperationView[], idCounts: Map<string, number>, errors: ValidationErrorDetail[]): void {
  const reported = new Set<string>();
  for (const op of ops) {
    if (typeof op.id === "string" && (idCounts.get(op.id) ?? 0) > 1 && !reported.has(op.id)) {
      errors.push({ operationId: op.id, field: "operations[].id", code: "DUPLICATE_OPERATION_ID", message: `duplicate operation id "${op.id}"` });
      reported.add(op.id);
    }
  }
}

/** Validate acyclic dependency graph (rule 5). */
function validateAcyclic(ops: readonly PlanOperationView[], errors: ValidationErrorDetail[]): void {
  const cycleNodes = ops
    .filter((op) => typeof op.id === "string" && Array.isArray(op.dependsOn))
    .map((op) => ({
      id: op.id as string,
      dependsOn: (op.dependsOn as readonly unknown[]).filter((d): d is string => typeof d === "string"),
    }));
  const cycle = findCycle(cycleNodes);
  if (cycle !== undefined) {
    errors.push({ field: "operations[].dependsOn", code: "CYCLE_DETECTED", message: `cycle detected: ${cycle.join(" -> ")}` });
  }
}

// ---------------------------------------------------------------------------
// Per-operation validation
// ---------------------------------------------------------------------------

type PlanOperationView = Record<string, unknown>;

/** Create an error with optional operationId. */
function opError(opId: string | undefined, field: string, code: string, message: string): ValidationErrorDetail {
  return opId !== undefined ? { operationId: opId, field, code, message } : { field, code, message };
}

/** Validate a single operation's shape and rules 4, 7-13. */
function validateOperation(op: PlanOperationView, idSet: Set<string>, errors: ValidationErrorDetail[]): void {
  const opId = typeof op.id === "string" ? op.id : undefined;

  validateOperationShape(op, opId, errors);
  validateDependsOn(op, opId, idSet, errors);
  validateImageDigest(op, opId, errors);
  validateTimeout(op, opId, errors);
  validateResources(op, opId, errors);
  validateRetry(op, opId, errors);
  validateNetwork(op, opId, errors);
  validateCache(op, opId, errors);
  validateCredentials(op, opId, errors);
}

/** Validate dependsOn references (rule 4). */
function validateDependsOn(op: PlanOperationView, opId: string | undefined, idSet: Set<string>, errors: ValidationErrorDetail[]): void {
  if (!Array.isArray(op.dependsOn)) return;
  for (const dep of op.dependsOn) {
    if (typeof dep !== "string") {
      errors.push(opError(opId, "operations[].dependsOn", "INVALID_DEPENDS_ON", "operation dependsOn must contain only strings"));
    } else if (!idSet.has(dep)) {
      errors.push(opError(opId, "operations[].dependsOn", "UNKNOWN_DEPENDENCY", `operation depends on unknown id "${dep}"`));
    }
  }
}

/** Validate imageDigest for docker/podman (rule 7). */
function validateImageDigest(op: PlanOperationView, opId: string | undefined, errors: ValidationErrorDetail[]): void {
  if (!isPlainObject(op.executor)) return;
  const ex = op.executor as { type?: unknown; imageDigest?: unknown };
  if (ex.type !== "docker" && ex.type !== "podman") return;
  if (typeof ex.imageDigest !== "string" || !isValidImageDigest(ex.imageDigest)) {
    errors.push(opError(opId, "operations[].executor.imageDigest", "MISSING_IMAGE_DIGEST", `executor of type "${ex.type}" requires a sha256 image digest`));
  }
}

/** Validate timeoutSeconds > 0 (rule 8). */
function validateTimeout(op: PlanOperationView, opId: string | undefined, errors: ValidationErrorDetail[]): void {
  if (typeof op.timeoutSeconds === "number" && Number.isFinite(op.timeoutSeconds) && op.timeoutSeconds > 0) return;
  errors.push(opError(opId, "operations[].timeoutSeconds", "INVALID_TIMEOUT", "timeoutSeconds must be a number greater than 0"));
}

/** Validate resources.cpu and resources.memory (rule 9). */
function validateResources(op: PlanOperationView, opId: string | undefined, errors: ValidationErrorDetail[]): void {
  if (isPlainObject(op.resources)) {
    const r = op.resources as { cpu?: unknown; memory?: unknown };
    const cpuOk = typeof r.cpu === "string" && isValidCpuString(r.cpu);
    const memOk = typeof r.memory === "string" && isValidMemoryString(r.memory);
    if (cpuOk && memOk) return;
  }
  errors.push(opError(opId, "operations[].resources", "INVALID_RESOURCES", String.raw`resources.cpu must be a number string and resources.memory must match /^\d+(Ki|Mi|Gi|Ti)?$/`));
}

/** Validate retry policy (rule 10). */
function validateRetry(op: PlanOperationView, opId: string | undefined, errors: ValidationErrorDetail[]): void {
  if (isPlainObject(op.retry)) {
    const rt = op.retry as { maxAttempts?: unknown; backoffSeconds?: unknown; retryOn?: unknown };
    const maxOk = typeof rt.maxAttempts === "number" && Number.isInteger(rt.maxAttempts) && rt.maxAttempts >= 1;
    const backOk = typeof rt.backoffSeconds === "number" && Number.isFinite(rt.backoffSeconds) && rt.backoffSeconds >= 0;
    const retryOnOk = Array.isArray(rt.retryOn) && rt.retryOn.every((v) => RETRY_ON_VALUES.has(v as string));
    if (maxOk && backOk && retryOnOk) return;
  }
  errors.push(opError(opId, "operations[].retry", "INVALID_RETRY_POLICY", "retry.maxAttempts must be >= 1, backoffSeconds >= 0, retryOn in (failure|timeout)"));
}

/** Validate network policy (rule 11). */
function validateNetwork(op: PlanOperationView, opId: string | undefined, errors: ValidationErrorDetail[]): void {
  if (typeof op.network === "string" && NETWORK_POLICIES.has(op.network)) return;
  errors.push(opError(opId, "operations[].network", "INVALID_NETWORK_POLICY", 'network must be one of "deny", "allow-host", "allow-egress"'));
}

/** Validate cache.key (rule 12). */
function validateCache(op: PlanOperationView, opId: string | undefined, errors: ValidationErrorDetail[]): void {
  if (op.cache === undefined) return;
  if (isPlainObject(op.cache)) {
    const c = op.cache as { key?: unknown };
    if (typeof c.key === "string" && c.key.length > 0) return;
    errors.push(opError(opId, "operations[].cache.key", "MISSING_CACHE_KEY", "cache.key must be a non-empty string when cache is declared"));
  } else {
    errors.push(opError(opId, "operations[].cache.key", "MISSING_CACHE_KEY", "cache must be an object with a non-empty key"));
  }
}

/** Validate credentials[].envVar (rule 13). */
function validateCredentials(op: PlanOperationView, opId: string | undefined, errors: ValidationErrorDetail[]): void {
  if (!Array.isArray(op.credentials)) return;
  for (const cred of op.credentials) {
    if (isPlainObject(cred)) {
      const c = cred as { envVar?: unknown };
      if (typeof c.envVar !== "string" || c.envVar.length === 0) {
        errors.push(opError(opId, "operations[].credentials[].envVar", "EMPTY_CREDENTIAL_ENVVAR", "credentials[].envVar must be a non-empty string"));
      }
    } else {
      errors.push(opError(opId, "operations[].credentials[].envVar", "EMPTY_CREDENTIAL_ENVVAR", "credentials[] entries must be objects"));
    }
  }
}

/** Validate operation identity fields (rule 15). */
function validateOperationIdentity(op: PlanOperationView, opId: string | undefined, errors: ValidationErrorDetail[]): void {
  if (typeof op.kind !== "string" || !OPERATION_KINDS.has(op.kind)) {
    errors.push(opError(opId, "operations[].kind", "INVALID_OPERATION", `operation kind must be one of ${[...OPERATION_KINDS].join(", ")}`));
  }
  if (typeof op.id !== "string" || op.id.length === 0) {
    errors.push(opError(opId, "operations[].id", "INVALID_OPERATION", "operation id must be a non-empty string"));
  }
}

/** Validate required operation fields (rule 15). */
function validateOperationShape(op: PlanOperationView, opId: string | undefined, errors: ValidationErrorDetail[]): void {
  validateOperationIdentity(op, opId, errors);
  validateOperationName(op, opId, errors);
  validateOperationExecutor(op, opId, errors);
  validateOperationDependsOn(op, opId, errors);
  validateOperationCredentialsArray(op, opId, errors);
  validateOperationArtifacts(op, opId, errors);
  validateOperationContinueOnError(op, opId, errors);
}

function validateOperationName(op: PlanOperationView, opId: string | undefined, errors: ValidationErrorDetail[]): void {
  if (typeof op.name !== "string") {
    errors.push(opError(opId, "operations[].name", "INVALID_OPERATION", "operation name must be a string"));
  }
}

function validateOperationExecutor(op: PlanOperationView, opId: string | undefined, errors: ValidationErrorDetail[]): void {
  if (!isPlainObject(op.executor)) {
    errors.push(opError(opId, "operations[].executor", "INVALID_OPERATION", "operation executor must be an object"));
  }
}

function validateOperationDependsOn(op: PlanOperationView, opId: string | undefined, errors: ValidationErrorDetail[]): void {
  if (op.dependsOn == null) {
    errors.push(opError(opId, "operations[].dependsOn", "INVALID_OPERATION", "operation dependsOn is required"));
  } else if (!Array.isArray(op.dependsOn)) {
    errors.push(opError(opId, "operations[].dependsOn", "INVALID_DEPENDS_ON", "operation dependsOn must be an array"));
  }
}

function validateOperationCredentialsArray(op: PlanOperationView, opId: string | undefined, errors: ValidationErrorDetail[]): void {
  if (!Array.isArray(op.credentials)) {
    errors.push(opError(opId, "operations[].credentials", "INVALID_OPERATION", "operation credentials must be an array"));
  }
}

function validateOperationArtifacts(op: PlanOperationView, opId: string | undefined, errors: ValidationErrorDetail[]): void {
  if (!Array.isArray(op.artifacts)) {
    errors.push(opError(opId, "operations[].artifacts", "INVALID_OPERATION", "operation artifacts must be an array"));
  }
}

function validateOperationContinueOnError(op: PlanOperationView, opId: string | undefined, errors: ValidationErrorDetail[]): void {
  if (typeof op.continueOnError !== "boolean") {
    errors.push(opError(opId, "operations[].continueOnError", "INVALID_OPERATION", "operation continueOnError must be a boolean"));
  }
}

/** Validate PlanMetadata fields: sverkaVersion (string), generatedBy (union). */
function validateMetadata(metadata: Record<string, unknown>, errors: ValidationErrorDetail[]): void {
  if (typeof metadata.sverkaVersion !== "string") {
    errors.push({ field: "metadata.sverkaVersion", code: "INVALID_METADATA", message: "metadata.sverkaVersion must be a string" });
  }
  if (typeof metadata.generatedBy !== "string" || !GENERATED_BY_VALUES.has(metadata.generatedBy)) {
    errors.push({ field: "metadata.generatedBy", code: "INVALID_METADATA", message: 'metadata.generatedBy must be one of "planner", "manual", "compiler"' });
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
