import type { Plan } from "./plan.js";
import { computePlanId } from "./ids.js";
import { findCycle } from "./internal/graph.js";

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
const IMAGE_DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const CPU_RE = /^\d+(\.\d+)?$/;
const MEMORY_RE = /^\d+(Ki|Mi|Gi|Ti)?$/;
const GENERATED_BY_VALUES = new Set(["planner", "manual", "compiler"]);

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

  if (!Array.isArray(p.operations)) {
    errors.push({ field: "operations", code: "EMPTY_OPERATIONS", message: "operations must be a non-empty array" });
    return { valid: errors.length === 0, errors };
  }

  const operations = p.operations as readonly unknown[];
  if (operations.length === 0) {
    errors.push({ field: "operations", code: "EMPTY_OPERATIONS", message: "operations must be non-empty" });
    return { valid: false, errors };
  }

  const ops = normalizeOperations(operations, errors);
  if (ops.length === 0) return { valid: false, errors };

  if (isPlainObject(p.metadata)) {
    validateMetadata(p.metadata as Record<string, unknown>, errors);
  }

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
  if (p.apiVersion !== "sverka.dev/v1") {
    errors.push({ field: "apiVersion", code: "INVALID_API_VERSION", message: `apiVersion must be "sverka.dev/v1"` });
  }

  const idIsNonEmptyString = typeof p.id === "string" && p.id.length > 0;
  if (!idIsNonEmptyString) {
    errors.push({ field: "id", code: "ID_MISMATCH", message: "id must be a non-empty string matching computePlanId" });
  }

  const shapeOk =
    p.apiVersion === "sverka.dev/v1" &&
    typeof p.name === "string" &&
    typeof p.sourceContextHash === "string" &&
    Array.isArray(p.operations) &&
    isPlainObject(p.metadata);

  if (shapeOk && idIsNonEmptyString) {
    recomputeId(p, errors);
  }
}

/** Recompute the plan id and compare with the declared id. */
function recomputeId(p: Record<string, unknown>, errors: ValidationErrorDetail[]): void {
  try {
    const body = {
      apiVersion: p.apiVersion,
      name: p.name,
      sourceContextHash: p.sourceContextHash,
      operations: p.operations,
      metadata: p.metadata,
    };
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
  const hasUnknownDep = errors.some((e) => e.code === "UNKNOWN_DEPENDENCY");
  if (hasUnknownDep) return;

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
    if (typeof dep !== "string" || !idSet.has(dep)) {
      errors.push(opError(opId, "operations[].dependsOn", "UNKNOWN_DEPENDENCY", `operation depends on unknown id "${String(dep)}"`));
    }
  }
}

/** Validate imageDigest for docker/podman (rule 7). */
function validateImageDigest(op: PlanOperationView, opId: string | undefined, errors: ValidationErrorDetail[]): void {
  if (!isPlainObject(op.executor)) return;
  const ex = op.executor as { type?: unknown; imageDigest?: unknown };
  if (ex.type !== "docker" && ex.type !== "podman") return;
  if (typeof ex.imageDigest !== "string" || !IMAGE_DIGEST_RE.test(ex.imageDigest)) {
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
    const cpuOk = typeof r.cpu === "string" && CPU_RE.test(r.cpu);
    const memOk = typeof r.memory === "string" && MEMORY_RE.test(r.memory);
    if (cpuOk && memOk) return;
  }
  errors.push(opError(opId, "operations[].resources", "INVALID_RESOURCES", "resources.cpu must be a number string and resources.memory must match /^\\d+(Ki|Mi|Gi|Ti)?$/"));
}

/** Validate retry policy (rule 10). */
function validateRetry(op: PlanOperationView, opId: string | undefined, errors: ValidationErrorDetail[]): void {
  if (isPlainObject(op.retry)) {
    const rt = op.retry as { maxAttempts?: unknown; backoffSeconds?: unknown; retryOn?: unknown };
    const maxOk = typeof rt.maxAttempts === "number" && Number.isFinite(rt.maxAttempts) && rt.maxAttempts >= 1;
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

/** Validate required operation fields (rule 15). */
function validateOperationShape(op: PlanOperationView, opId: string | undefined, errors: ValidationErrorDetail[]): void {
  if (typeof op.id !== "string" || op.id.length === 0) {
    errors.push(opError(opId, "operations[].id", "INVALID_OPERATION", "operation id must be a non-empty string"));
  }
  if (typeof op.name !== "string") {
    errors.push(opError(opId, "operations[].name", "INVALID_OPERATION", "operation name must be a string"));
  }
  if (!isPlainObject(op.executor)) {
    errors.push(opError(opId, "operations[].executor", "INVALID_OPERATION", "operation executor must be an object"));
  }
  if (!Array.isArray(op.dependsOn)) {
    errors.push(opError(opId, "operations[].dependsOn", "INVALID_OPERATION", "operation dependsOn must be an array"));
  }
  if (!Array.isArray(op.credentials)) {
    errors.push(opError(opId, "operations[].credentials", "INVALID_OPERATION", "operation credentials must be an array"));
  }
  if (!Array.isArray(op.artifacts)) {
    errors.push(opError(opId, "operations[].artifacts", "INVALID_OPERATION", "operation artifacts must be an array"));
  }
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
