import type {
  OperationOutcome,
  Runtime,
  RuntimeFinalization,
  RuntimeMode,
  PlanContext,
} from "../../runtime.js";
import type { OperationSpec } from "../../operation.js";

/**
 * Build a test Runtime for the given mode. In `plan` mode it records
 * operations without side effects. In `execute` mode it calls `evaluate`
 * for each and returns success outcomes. In `compile` mode it produces a
 * string artifact.
 */
export function makeRuntime(opts: {
  mode?: RuntimeMode;
  context?: PlanContext;
  onEvaluate?: (spec: OperationSpec) => OperationOutcome;
}): Runtime {
  const mode = opts.mode ?? "plan";
  const evaluated: OperationSpec[] = [];
  const outcomes: OperationOutcome[] = [];
  return {
    mode,
    ...(opts.context !== undefined ? { context: opts.context } : {}),
    async evaluate(operation: OperationSpec): Promise<OperationOutcome> {
      evaluated.push(operation);
      const outcome: OperationOutcome =
        opts.onEvaluate?.(operation) ?? {
          operationId: operation.id,
          status: mode === "plan" ? "planned" : "success",
          durationMs: 0,
        };
      outcomes.push(outcome);
      return outcome;
    },
    async finalize(): Promise<RuntimeFinalization> {
      const artifacts =
        mode === "compile"
          ? [{ name: "compiled", content: evaluated.map((o) => o.id).join("\n") }]
          : undefined;
      return {
        mode,
        ...(artifacts !== undefined ? { artifacts } : {}),
      };
    },
  };
}

/** A minimal plan-mode runtime (no side effects, records operations). */
export function makePlanRuntime(context?: PlanContext): Runtime {
  return makeRuntime({ mode: "plan", ...(context !== undefined ? { context } : {}) });
}

/** An execution-mode runtime that records evaluate calls. */
export function makeExecuteRuntime(
  context?: PlanContext,
  onEvaluate?: (spec: OperationSpec) => OperationOutcome,
): Runtime {
  return makeRuntime({
    mode: "execute",
    ...(context !== undefined ? { context } : {}),
    ...(onEvaluate !== undefined ? { onEvaluate } : {}),
  });
}

/** A compile-mode runtime that emits a string artifact. */
export function makeCompileRuntime(
  context?: PlanContext,
  onEvaluate?: (spec: OperationSpec) => OperationOutcome,
): Runtime {
  return makeRuntime({
    mode: "compile",
    ...(context !== undefined ? { context } : {}),
    ...(onEvaluate !== undefined ? { onEvaluate } : {}),
  });
}
