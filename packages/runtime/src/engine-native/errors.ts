// Error classes for @sverka/engine-native. Spec 10 — Error handling.

export type EngineErrorCode =
  | "SCHEDULER_ERROR"
  | "STEP_EXEC_ERROR"
  | "NO_DRIVER"
  | "TIMEOUT"
  | "OUTPUT_CAPTURE_ERROR"
  | "ARTIFACT_ERROR";

export class EngineError extends Error {
  override readonly cause: unknown;
  readonly code: EngineErrorCode;

  constructor(message: string, code: EngineErrorCode, cause?: unknown) {
    super(message);
    this.name = "EngineError";
    this.code = code;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/** Raised when the scheduler detects a cycle or invalid DAG. */
export class SchedulerError extends EngineError {
  constructor(message: string, cause?: unknown) {
    super(message, "SCHEDULER_ERROR", cause);
    this.name = "SchedulerError";
  }
}

/** Raised when a step's operations fail during execution. */
export class StepExecError extends EngineError {
  readonly exitCode?: number;
  readonly timedOut?: boolean;

  constructor(message: string, code: EngineErrorCode, cause?: unknown, exitCode?: number, timedOut?: boolean) {
    super(message, code, cause);
    this.name = "StepExecError";
    if (exitCode !== undefined) {
      this.exitCode = exitCode;
    }
    if (timedOut !== undefined) {
      this.timedOut = timedOut;
    }
  }
}
