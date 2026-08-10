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

/**
 * Validate an unknown value as a Plan. Returns a {@link ValidationResult};
 * never throws. Collects all detectable errors (does not short-circuit) so
 * callers get the full picture.
 */
export function validatePlan(plan: unknown): ValidationResult {
  const errors: ValidationErrorDetail[] = [];

  // Top-level shape.
  if (!isPlainObject(plan) || Array.isArray(plan)) {
    errors.push({
      field: "",
      code: "INVALID_PLAN",
      message: "plan must be a plain object",
    });
    return { valid: false, errors };
  }

  const p = plan as Record<string, unknown>;

  validateTopLevelFields(p, errors);

  const operationsOk = Array.isArray(p.operations);
  const ops = normalizeOperations(p, operationsOk, errors);
  if (ops === undefined) {
    return { valid: errors.length === 0, errors };
  }

  collectDuplicateIds(ops, errors);

  const idSet = new Set<string>();
  for (const op of ops) {
    if (typeof op.id === "string") idSet.add(op.id);
  }

  for (const op of ops) {
    validateOperation(op, idSet, errors);
  }

  validateAcyclicity(ops, errors);

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type PlanOperationView = Record<string, unknown>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateTopLevelFields(
  p: Record<string, unknown>,
  errors: ValidationErrorDetail[],
): void {
  validateApiVersion(p, errors);
  const idIsNonEmptyString = validateId(p, errors);
  validatePlanIdIfShapeOk(p, errors, idIsNonEmptyString);
  validateOperationsShape(p, errors);
}

function validateApiVersion(
  p: Record<string, unknown>,
  errors: ValidationErrorDetail[],
): void {
  // Rule 1: apiVersion.
  if (p.apiVersion !== "sverka.dev/v1") {
    errors.push({
      field: "apiVersion",
      code: "INVALID_API_VERSION",
      message: `apiVersion must be "sverka.dev/v1"`,
    });
  }
}

function validateId(
  p: Record<string, unknown>,
  errors: ValidationErrorDetail[],
): boolean {
  // Rule 2a: id must be a non-empty string.
  const idIsNonEmptyString = typeof p.id === "string" && p.id.length > 0;
  if (!idIsNonEmptyString) {
    errors.push({
      field: "id",
      code: "ID_MISMATCH",
      message: "id must be a non-empty string matching computePlanId",
    });
  }
  return idIsNonEmptyString;
}

function validatePlanIdIfShapeOk(
  p: Record<string, unknown>,
  errors: ValidationErrorDetail[],
  idIsNonEmptyString: boolean,
): void {
  const shapeOk = checkShapeOk(p);
  // Rule 2b: id matches recomputed computePlanId (only when shape is valid,
  // and never let it throw).
  if (shapeOk && idIsNonEmptyString) {
    validatePlanId(p, errors);
  }
}

function checkShapeOk(p: Record<string, unknown>): boolean {
  const nameOk = typeof p.name === "string";
  const sourceContextHashOk = typeof p.sourceContextHash === "string";
  const operationsOk = Array.isArray(p.operations);
  const metadataOk = isPlainObject(p.metadata);
  return (
    p.apiVersion === "sverka.dev/v1" &&
    nameOk &&
    sourceContextHashOk &&
    operationsOk &&
    metadataOk
  );
}

function validateOperationsShape(
  p: Record<string, unknown>,
  errors: ValidationErrorDetail[],
): void {
  // Rule 3: operations non-empty array.
  if (!Array.isArray(p.operations)) {
    errors.push({
      field: "operations",
      code: "EMPTY_OPERATIONS",
      message: "operations must be a non-empty array",
    });
    return;
  }
  const operations = p.operations as readonly unknown[];
  if (operations.length === 0) {
    errors.push({
      field: "operations",
      code: "EMPTY_OPERATIONS",
      message: "operations must be non-empty",
    });
  }
}

function validatePlanId(
  p: Record<string, unknown>,
  errors: ValidationErrorDetail[],
): void {
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
      errors.push({
        field: "id",
        code: "ID_MISMATCH",
        message: `id does not match recomputed plan id (expected ${expected})`,
      });
    }
  } catch {
    errors.push({
      field: "id",
      code: "ID_MISMATCH",
      message: "could not recompute plan id",
    });
  }
}

function normalizeOperations(
  p: Record<string, unknown>,
  operationsOk: boolean,
  errors: ValidationErrorDetail[],
): PlanOperationView[] | undefined {
  if (!operationsOk) return undefined;
  const operations = p.operations as readonly unknown[];
  if (operations.length === 0) return undefined;

  const ops: PlanOperationView[] = [];
  for (let i = 0; i < operations.length; i++) {
    const raw = operations[i];
    if (!isPlainObject(raw)) {
      errors.push({
        field: "operations[]",
        code: "INVALID_OPERATION",
        message: `operations[${i}] must be a plain object`,
      });
      continue;
    }
    ops.push(raw as PlanOperationView);
  }
  if (ops.length === 0) return undefined;
  return ops;
}

function collectDuplicateIds(
  ops: PlanOperationView[],
  errors: ValidationErrorDetail[],
): void {
  // Rule 6: unique operation ids (collect first; reused by rules 4 & 5).
  const idCounts = countIds(ops);
  const reportedDup = new Set<string>();
  for (const op of ops) {
    if (!isDuplicateId(op, idCounts, reportedDup)) continue;
    errors.push({
      operationId: op.id as string,
      field: "operations[].id",
      code: "DUPLICATE_OPERATION_ID",
      message: `duplicate operation id "${op.id as string}"`,
    });
    reportedDup.add(op.id as string);
  }
}

function countIds(ops: PlanOperationView[]): Map<string, number> {
  const idCounts = new Map<string, number>();
  for (const op of ops) {
    if (typeof op.id === "string") {
      idCounts.set(op.id, (idCounts.get(op.id) ?? 0) + 1);
    }
  }
  return idCounts;
}

function isDuplicateId(
  op: PlanOperationView,
  idCounts: Map<string, number>,
  reportedDup: Set<string>,
): boolean {
  if (typeof op.id !== "string") return false;
  if ((idCounts.get(op.id) ?? 0) <= 1) return false;
  return !reportedDup.has(op.id);
}

function validateOperation(
  op: PlanOperationView,
  idSet: Set<string>,
  errors: ValidationErrorDetail[],
): void {
  const opId = typeof op.id === "string" ? op.id : undefined;

  validateDependsOn(op, opId, idSet, errors);
  validateExecutor(op, opId, errors);
  validateTimeout(op, opId, errors);
  validateResources(op, opId, errors);
  validateRetry(op, opId, errors);
  validateNetwork(op, opId, errors);
  validateCache(op, opId, errors);
  validateCredentials(op, opId, errors);
}

function opError(
  opId: string | undefined,
  field: string,
  code: string,
  message: string,
  errors: ValidationErrorDetail[],
): void {
  errors.push({
    ...(opId !== undefined ? { operationId: opId } : {}),
    field,
    code,
    message,
  });
}

function validateDependsOn(
  op: PlanOperationView,
  opId: string | undefined,
  idSet: Set<string>,
  errors: ValidationErrorDetail[],
): void {
  // Rule 4: dependsOn references must exist.
  if (!Array.isArray(op.dependsOn)) return;
  for (const dep of op.dependsOn) {
    if (typeof dep !== "string" || !idSet.has(dep)) {
      opError(opId, "operations[].dependsOn", "UNKNOWN_DEPENDENCY",
        `operation depends on unknown id "${String(dep)}"`, errors);
    }
  }
}

function validateExecutor(
  op: PlanOperationView,
  opId: string | undefined,
  errors: ValidationErrorDetail[],
): void {
  // Rule 7: imageDigest required for docker/podman.
  if (!isPlainObject(op.executor)) return;
  const ex = op.executor as { type?: unknown; imageDigest?: unknown };
  if (ex.type !== "docker" && ex.type !== "podman") return;
  if (typeof ex.imageDigest !== "string" || !IMAGE_DIGEST_RE.test(ex.imageDigest)) {
    opError(opId, "operations[].executor.imageDigest", "MISSING_IMAGE_DIGEST",
      `executor of type "${ex.type}" requires a sha256 image digest`, errors);
  }
}

function validateTimeout(
  op: PlanOperationView,
  opId: string | undefined,
  errors: ValidationErrorDetail[],
): void {
  // Rule 8: timeoutSeconds > 0.
  if (typeof op.timeoutSeconds !== "number" || !Number.isFinite(op.timeoutSeconds) || op.timeoutSeconds <= 0) {
    opError(opId, "operations[].timeoutSeconds", "INVALID_TIMEOUT",
      "timeoutSeconds must be a number greater than 0", errors);
  }
}

function validateResources(
  op: PlanOperationView,
  opId: string | undefined,
  errors: ValidationErrorDetail[],
): void {
  // Rule 9: resources parseable.
  if (isPlainObject(op.resources)) {
    const r = op.resources as { cpu?: unknown; memory?: unknown };
    const cpuOk = typeof r.cpu === "string" && CPU_RE.test(r.cpu);
    const memOk = typeof r.memory === "string" && MEMORY_RE.test(r.memory);
    if (!cpuOk || !memOk) {
      opError(opId, "operations[].resources", "INVALID_RESOURCES",
        "resources.cpu must be a number string and resources.memory must match /^\\d+(Ki|Mi|Gi|Ti)?$/", errors);
    }
  } else {
    opError(opId, "operations[].resources", "INVALID_RESOURCES",
      "resources must be an object with cpu and memory", errors);
  }
}

function validateRetry(
  op: PlanOperationView,
  opId: string | undefined,
  errors: ValidationErrorDetail[],
): void {
  // Rule 10: retry policy.
  if (isPlainObject(op.retry)) {
    const rt = op.retry as {
      maxAttempts?: unknown;
      backoffSeconds?: unknown;
      retryOn?: unknown;
    };
    const maxOk =
      typeof rt.maxAttempts === "number" &&
      Number.isFinite(rt.maxAttempts) &&
      rt.maxAttempts >= 1;
    const backOk =
      typeof rt.backoffSeconds === "number" &&
      Number.isFinite(rt.backoffSeconds) &&
      rt.backoffSeconds >= 0;
    const retryOnOk =
      Array.isArray(rt.retryOn) &&
      rt.retryOn.every((v) => RETRY_ON_VALUES.has(v as string));
    if (!maxOk || !backOk || !retryOnOk) {
      opError(opId, "operations[].retry", "INVALID_RETRY_POLICY",
        "retry.maxAttempts must be >= 1, backoffSeconds >= 0, retryOn in (failure|timeout)", errors);
    }
  } else {
    opError(opId, "operations[].retry", "INVALID_RETRY_POLICY",
      "retry must be an object", errors);
  }
}

function validateNetwork(
  op: PlanOperationView,
  opId: string | undefined,
  errors: ValidationErrorDetail[],
): void {
  // Rule 11: network policy.
  if (typeof op.network !== "string" || !NETWORK_POLICIES.has(op.network)) {
    opError(opId, "operations[].network", "INVALID_NETWORK_POLICY",
      'network must be one of "deny", "allow-host", "allow-egress"', errors);
  }
}

function validateCache(
  op: PlanOperationView,
  opId: string | undefined,
  errors: ValidationErrorDetail[],
): void {
  // Rule 12: cache.key required when cache declared.
  if (op.cache === undefined) return;
  if (isPlainObject(op.cache)) {
    const c = op.cache as { key?: unknown };
    if (typeof c.key !== "string" || c.key.length === 0) {
      opError(opId, "operations[].cache.key", "MISSING_CACHE_KEY",
        "cache.key must be a non-empty string when cache is declared", errors);
    }
  } else {
    opError(opId, "operations[].cache.key", "MISSING_CACHE_KEY",
      "cache must be an object with a non-empty key", errors);
  }
}

function validateCredentials(
  op: PlanOperationView,
  opId: string | undefined,
  errors: ValidationErrorDetail[],
): void {
  // Rule 13: credentials[].envVar non-empty.
  if (!Array.isArray(op.credentials)) return;
  for (const cred of op.credentials) {
    if (isPlainObject(cred)) {
      const c = cred as { envVar?: unknown };
      if (typeof c.envVar !== "string" || c.envVar.length === 0) {
        opError(opId, "operations[].credentials[].envVar", "EMPTY_CREDENTIAL_ENVVAR",
          "credentials[].envVar must be a non-empty string", errors);
      }
    } else {
      opError(opId, "operations[].credentials[].envVar", "EMPTY_CREDENTIAL_ENVVAR",
        "credentials[] entries must be objects", errors);
    }
  }
}

function validateAcyclicity(
  ops: PlanOperationView[],
  errors: ValidationErrorDetail[],
): void {
  // Rule 5: acyclic (only meaningful when all deps reference known ids).
  const hasUnknownDep = errors.some((e) => e.code === "UNKNOWN_DEPENDENCY");
  if (hasUnknownDep) return;
  const cycleNodes = ops
    .filter((op) => typeof op.id === "string" && Array.isArray(op.dependsOn))
    .map((op) => ({
      id: op.id as string,
      dependsOn: (op.dependsOn as readonly unknown[]).filter(
        (d): d is string => typeof d === "string",
      ),
    }));
  const cycle = findCycle(cycleNodes);
  if (cycle !== undefined) {
    errors.push({
      field: "operations[].dependsOn",
      code: "CYCLE_DETECTED",
      message: `cycle detected: ${cycle.join(" -> ")}`,
    });
  }
}
