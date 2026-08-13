/**
 * Base error class for the runtime package. All runtime errors extend this so
 * callers can catch the full family with a single `instanceof
 * RuntimeExecutionError`.
 */
export class RuntimeExecutionError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "RuntimeExecutionError";
  }
}

/** Raised when the scheduler cannot proceed (no executor, cycle, resources). */
export class SchedulerError extends RuntimeExecutionError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "SCHEDULER_ERROR", context);
    this.name = "SchedulerError";
  }
}

/** Wraps failures raised by an Executor. */
export class ExecutorError extends RuntimeExecutionError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "EXECUTOR_ERROR", context);
    this.name = "ExecutorError";
  }
}
