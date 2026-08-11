/**
 * Base error class for the core package. All core errors extend this so
 * callers can catch the full family with a single `instanceof CoreError`.
 */
export class CoreError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CoreError";
  }
}

/** Raised when planning performs or attempts a side effect. */
export class PlanningError extends CoreError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "PLANNING_ERROR", context);
    this.name = "PlanningError";
  }
}

/** Raised when composition produces an invalid graph (cycle, duplicate id). */
export class CompositionError extends CoreError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "COMPOSITION_ERROR", context);
    this.name = "CompositionError";
  }
}
