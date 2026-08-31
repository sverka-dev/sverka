import type { PlanRuntime as IPlanRuntime, RuntimeMode, RuntimeResult, OperationOutcome, OperationSpec } from "@sverka/workflow";

/**
 * A plan-mode Runtime that records operations without side effects.
 * Used by the SDK to evaluate a workflow graph into an OperationSpec[]
 * without executing any commands.
 */
export class PlanRuntime implements IPlanRuntime {
  readonly mode: RuntimeMode = "plan";
  private readonly recorded: OperationSpec[] = [];
  private readonly start: number;

  constructor() {
    this.start = Date.now();
  }

  async evaluate(operation: OperationSpec): Promise<OperationOutcome> {
    this.recorded.push(operation);
    return {
      operationId: operation.id,
      status: "planned",
      durationMs: 0,
    };
  }

  async finalize(): Promise<RuntimeResult> {
    return {
      mode: "plan",
      operations: this.recorded,
      outcomes: [],
      durationMs: Date.now() - this.start,
    };
  }
}
