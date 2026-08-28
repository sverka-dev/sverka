import type { Plan, PlanOperation } from "@sverka/workflow";
import { computePlanId } from "@sverka/workflow";
import type {
  Executor,
  ExecuteRequest,
  ExecuteResult,
} from "../../executor.js";

/**
 * A single valid operation. Matches the IR `validOperation` shape but lives
 * in the runtime test helpers so the runtime package does not depend on
 * `@sverka/ir` test internals.
 */
export function validOperation(
  overrides: Partial<PlanOperation> = {},
): PlanOperation {
  const base: PlanOperation = {
    id: "op-a",
    kind: "run",
    name: "build",
    dependsOn: [],
    executor: { type: "host" },
    resources: { cpu: "1", memory: "512Mi" },
    network: "deny",
    credentials: [],
    artifacts: [],
    retry: { maxAttempts: 1, backoffSeconds: 0, retryOn: ["failure"] },
    timeoutSeconds: 60,
    continueOnError: false,
  };
  return { ...base, ...overrides };
}

/** A complete, valid Plan with the deterministic id and a fixed createdAt. */
export function validPlan(
  overrides: Partial<Omit<Plan, "id" | "createdAt">> = {},
): Plan {
  const body: Omit<Plan, "id" | "createdAt"> = {
    apiVersion: "sverka.dev/v1",
    name: "ci",
    sourceContextHash: "abc123",
    operations: [validOperation()],
    metadata: { sverkaVersion: "0.0.0", generatedBy: "planner" },
    ...overrides,
  };
  const id = computePlanId(body);
  return { ...body, id, createdAt: "2026-01-01T00:00:00.000Z" };
}

/** Build an operation with a stable id and optional deps. */
export function op(
  id: string,
  dependsOn: readonly string[] = [],
  overrides: Partial<PlanOperation> = {},
): PlanOperation {
  return validOperation({ id, name: id, dependsOn, ...overrides });
}

/** Build a plan from a list of operations (ids derived from op ids). */
export function planFromOps(operations: readonly PlanOperation[]): Plan {
  return validPlan({ operations });
}

/**
 * A mock executor that records every `execute` call and returns a canned
 * `ExecuteResult` (default: success). `canExecute` is configurable; the
 * default accepts every operation.
 */
export class MockExecutor implements Executor {
  readonly name: string;
  readonly calls: ExecuteRequest[] = [];
  private readonly canExecuteFn: (op: PlanOperation) => boolean;
  private readonly resultFn: (req: ExecuteRequest) => ExecuteResult | Promise<ExecuteResult>;
  disposed = false;

  constructor(opts: {
    name?: string;
    canExecute?: (op: PlanOperation) => boolean;
    result?:
      | ExecuteResult
      | ((req: ExecuteRequest) => ExecuteResult | Promise<ExecuteResult>);
  } = {}) {
    this.name = opts.name ?? "mock";
    this.canExecuteFn = opts.canExecute ?? (() => true);
    const r = opts.result;
    if (typeof r === "function") {
      this.resultFn = r as (req: ExecuteRequest) => ExecuteResult | Promise<ExecuteResult>;
    } else {
      const canned: ExecuteResult = r ?? {
        operationId: "op-?",
        status: "success",
        durationMs: 1,
        logs: "",
        artifacts: [],
      };
      this.resultFn = () => canned;
    }
  }

  canExecute(operation: PlanOperation): boolean {
    return this.canExecuteFn(operation);
  }

  async execute(request: ExecuteRequest): Promise<ExecuteResult> {
    this.calls.push(request);
    const r = await this.resultFn(request);
    // Ensure operationId is set to the actual op id if the canned result
    // used the placeholder.
    return r.operationId === "op-?" ? { ...r, operationId: request.operation.id } : r;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }
}

/** A canned success result for a given operation id. */
export function successResult(
  operationId: string,
  overrides: Partial<ExecuteResult> = {},
): ExecuteResult {
  return {
    operationId,
    status: "success",
    durationMs: 1,
    logs: "",
    artifacts: [],
    ...overrides,
  };
}

/** A canned failure result for a given operation id. */
export function failureResult(
  operationId: string,
  overrides: Partial<ExecuteResult> = {},
): ExecuteResult {
  return {
    operationId,
    status: "failure",
    durationMs: 1,
    logs: "",
    artifacts: [],
    error: "failed",
    ...overrides,
  };
}
