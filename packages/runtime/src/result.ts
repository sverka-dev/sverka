export interface OperationOutcome {
  readonly operationId: string;
  readonly status: "success" | "failure" | "skipped" | "cancelled";
  readonly exitCode?: number;
  readonly durationMs: number;
  readonly logs: string;
  readonly artifacts: readonly string[];
  readonly error?: string;
  readonly fromCache: boolean;
}

export interface ExecutionResult {
  readonly planId: string;
  /**
   * - "success": every outcome is success or skipped.
   * - "failure": a fatal failure occurred (continueOnError=false on the
   *   failed op) and its dependents were cancelled.
   * - "partial": execution was cancelled via cancel(), OR execution
   *   completed with some failures under continueOnError.
   */
  readonly status: "success" | "failure" | "partial";
  readonly outcomes: ReadonlyMap<string, OperationOutcome>;
  readonly durationMs: number;
  readonly cancelledOperations: readonly string[];
}

export interface ExecutionState {
  readonly planId: string;
  readonly completed: readonly string[];
  readonly failed: readonly string[];
  readonly skipped: readonly string[];
  readonly running: readonly string[];
  readonly outcomes: ReadonlyMap<string, OperationOutcome>;
  readonly updatedAt: string;
}
