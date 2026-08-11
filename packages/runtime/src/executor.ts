import type { PlanOperation } from "@sverka/ir";

/**
 * A request to execute a single plan operation.
 */
export interface ExecuteRequest {
  readonly operation: PlanOperation;
  readonly workspace: string; // path to mounted/available workspace
  readonly env: Readonly<Record<string, string>>;
  readonly credentials: Readonly<Record<string, string>>;
  readonly cacheDir: string;
  readonly artifactDir: string;
}

/**
 * The result of executing a single operation.
 */
export interface ExecuteResult {
  readonly operationId: string;
  readonly status: "success" | "failure" | "skipped" | "cancelled";
  readonly exitCode?: number;
  readonly durationMs: number;
  readonly logs: string;
  readonly artifacts: readonly string[];
  readonly error?: string;
  /**
   * True when the operation failed because of an executor-level fault
   * (e.g., the binary could not be spawned) rather than the operation's own
   * non-zero exit code. Distinguishes runtime errors from policy failures.
   */
  readonly runtimeFailure?: boolean;
}

/**
 * The Executor interface. Concrete executors (Docker, Podman, host, remote)
 * implement this. The scheduler queries `canExecute` to route operations.
 */
export interface Executor {
  readonly name: string;
  /** Return true if this executor can run the given operation. */
  canExecute(operation: PlanOperation): boolean;
  /** Execute the operation. Must respect timeout and resource limits. */
  execute(request: ExecuteRequest): Promise<ExecuteResult>;
  /** Optional cleanup when the scheduler shuts down. */
  dispose?(): Promise<void>;
}
