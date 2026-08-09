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
const MEMORY_RE = /^[0-9]+(Ki|Mi|Gi|Ti)?$/;

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

  // Rule 1: apiVersion.
  if (p.apiVersion !== "sverka.dev/v1") {
    errors.push({
      field: "apiVersion",
      code: "INVALID_API_VERSION",
      message: `apiVersion must be "sverka.dev/v1"`,
    });
  }

  // Rule 2a: id must be a non-empty string.
  const idIsNonEmptyString =
    typeof p.id === "string" && p.id.length > 0;
  if (!idIsNonEmptyString) {
    errors.push({
      field: "id",
      code: "ID_MISMATCH",
      message: "id must be a non-empty string matching computePlanId",
    });
  }

  // Structural fields needed for rule-2 recompute and downstream rules.
  const nameOk = typeof p.name === "string";
  const sourceContextHashOk = typeof p.sourceContextHash === "string";
  const operationsOk = Array.isArray(p.operations);
  const metadataOk = isPlainObject(p.metadata);
  const shapeOk =
    p.apiVersion === "sverka.dev/v1" &&
    nameOk &&
    sourceContextHashOk &&
    operationsOk &&
    metadataOk;

  // Rule 2b: id matches recomputed computePlanId (only when shape is valid,
  // and never let it throw).
  if (shapeOk && idIsNonEmptyString) {
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

  // Rule 3: operations non-empty array.
  if (!operationsOk) {
    errors.push({
      field: "operations",
      code: "EMPTY_OPERATIONS",
      message: "operations must be a non-empty array",
    });
    // Cannot continue per-operation validation without an array.
    return { valid: errors.length === 0, errors };
  }
  const operations = p.operations as readonly unknown[];
  if (operations.length === 0) {
    errors.push({
      field: "operations",
      code: "EMPTY_OPERATIONS",
      message: "operations must be non-empty",
    });
    return { valid: false, errors };
  }

  // Normalize operations into typed views; reject non-object entries.
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
  if (ops.length === 0) {
    return { valid: false, errors };
  }

  // Rule 6: unique operation ids (collect first; reused by rules 4 & 5).
  const idSet = new Set<string>();
  const idCounts = new Map<string, number>();
  for (const op of ops) {
    if (typeof op.id === "string") {
      idSet.add(op.id);
      idCounts.set(op.id, (idCounts.get(op.id) ?? 0) + 1);
    }
  }
  const reportedDup = new Set<string>();
  for (const op of ops) {
    if (typeof op.id === "string" && (idCounts.get(op.id) ?? 0) > 1 && !reportedDup.has(op.id)) {
      errors.push({
        operationId: op.id,
        field: "operations[].id",
        code: "DUPLICATE_OPERATION_ID",
        message: `duplicate operation id "${op.id}"`,
      });
      reportedDup.add(op.id);
    }
  }

  // Per-operation rules 4, 7, 8, 9, 10, 11, 12, 13.
  for (const op of ops) {
    const opId = typeof op.id === "string" ? op.id : undefined;

    // Rule 4: dependsOn references must exist.
    if (Array.isArray(op.dependsOn)) {
      for (const dep of op.dependsOn) {
        if (typeof dep !== "string" || !idSet.has(dep)) {
          errors.push({
            ...(opId !== undefined ? { operationId: opId } : {}),
            field: "operations[].dependsOn",
            code: "UNKNOWN_DEPENDENCY",
            message: `operation depends on unknown id "${String(dep)}"`,
          });
        }
      }
    }

    // Rule 7: imageDigest required for docker/podman.
    if (isPlainObject(op.executor)) {
      const ex = op.executor as { type?: unknown; imageDigest?: unknown };
      if (ex.type === "docker" || ex.type === "podman") {
        if (typeof ex.imageDigest !== "string" || !IMAGE_DIGEST_RE.test(ex.imageDigest)) {
          errors.push({
            ...(opId !== undefined ? { operationId: opId } : {}),
            field: "operations[].executor.imageDigest",
            code: "MISSING_IMAGE_DIGEST",
            message: `executor of type "${ex.type}" requires a sha256 image digest`,
          });
        }
      }
    }

    // Rule 8: timeoutSeconds > 0.
    if (typeof op.timeoutSeconds !== "number" || !Number.isFinite(op.timeoutSeconds) || op.timeoutSeconds <= 0) {
      errors.push({
        ...(opId !== undefined ? { operationId: opId } : {}),
        field: "operations[].timeoutSeconds",
        code: "INVALID_TIMEOUT",
        message: "timeoutSeconds must be a number greater than 0",
      });
    }

    // Rule 9: resources parseable.
    if (isPlainObject(op.resources)) {
      const r = op.resources as { cpu?: unknown; memory?: unknown };
      const cpuOk = typeof r.cpu === "string" && CPU_RE.test(r.cpu);
      const memOk = typeof r.memory === "string" && MEMORY_RE.test(r.memory);
      if (!cpuOk || !memOk) {
        errors.push({
          ...(opId !== undefined ? { operationId: opId } : {}),
          field: "operations[].resources",
          code: "INVALID_RESOURCES",
          message: "resources.cpu must be a number string and resources.memory must match /^[0-9]+(Ki|Mi|Gi|Ti)?$/",
        });
      }
    } else {
      errors.push({
        ...(opId !== undefined ? { operationId: opId } : {}),
        field: "operations[].resources",
        code: "INVALID_RESOURCES",
        message: "resources must be an object with cpu and memory",
      });
    }

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
        errors.push({
          ...(opId !== undefined ? { operationId: opId } : {}),
          field: "operations[].retry",
          code: "INVALID_RETRY_POLICY",
          message:
            "retry.maxAttempts must be >= 1, backoffSeconds >= 0, retryOn in (failure|timeout)",
        });
      }
    } else {
      errors.push({
        ...(opId !== undefined ? { operationId: opId } : {}),
        field: "operations[].retry",
        code: "INVALID_RETRY_POLICY",
        message: "retry must be an object",
      });
    }

    // Rule 11: network policy.
    if (typeof op.network !== "string" || !NETWORK_POLICIES.has(op.network)) {
      errors.push({
        ...(opId !== undefined ? { operationId: opId } : {}),
        field: "operations[].network",
        code: "INVALID_NETWORK_POLICY",
        message: 'network must be one of "deny", "allow-host", "allow-egress"',
      });
    }

    // Rule 12: cache.key required when cache declared.
    if (op.cache !== undefined) {
      if (isPlainObject(op.cache)) {
        const c = op.cache as { key?: unknown };
        if (typeof c.key !== "string" || c.key.length === 0) {
          errors.push({
            ...(opId !== undefined ? { operationId: opId } : {}),
            field: "operations[].cache.key",
            code: "MISSING_CACHE_KEY",
            message: "cache.key must be a non-empty string when cache is declared",
          });
        }
      } else {
        errors.push({
          ...(opId !== undefined ? { operationId: opId } : {}),
          field: "operations[].cache.key",
          code: "MISSING_CACHE_KEY",
          message: "cache must be an object with a non-empty key",
        });
      }
    }

    // Rule 13: credentials[].envVar non-empty.
    if (Array.isArray(op.credentials)) {
      for (const cred of op.credentials) {
        if (isPlainObject(cred)) {
          const c = cred as { envVar?: unknown };
          if (typeof c.envVar !== "string" || c.envVar.length === 0) {
            errors.push({
              ...(opId !== undefined ? { operationId: opId } : {}),
              field: "operations[].credentials[].envVar",
              code: "EMPTY_CREDENTIAL_ENVVAR",
              message: "credentials[].envVar must be a non-empty string",
            });
          }
        } else {
          errors.push({
            ...(opId !== undefined ? { operationId: opId } : {}),
            field: "operations[].credentials[].envVar",
            code: "EMPTY_CREDENTIAL_ENVVAR",
            message: "credentials[] entries must be objects",
          });
        }
      }
    }
  }

  // Rule 5: acyclic (only meaningful when all deps reference known ids).
  const hasUnknownDep = errors.some((e) => e.code === "UNKNOWN_DEPENDENCY");
  if (!hasUnknownDep) {
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

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type PlanOperationView = Record<string, unknown>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
