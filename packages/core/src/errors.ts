// SynthesisError — thrown during synthesis validation.
// Spec 05 — Error handling.

export type SynthesisErrorCode =
  | "CYCLE"
  | "UNKNOWN_PRODUCER"
  | "OUTPUT_COLLISION"
  | "INCOMPATIBLE_REFERENCE"
  | "INVALID_OUTPUT"
  | "INVALID_SCOPE"
  | "INVALID_ENTRY"
  | "UNKNOWN_CALLEE"
  | "MISSING_INPUT_BINDING"
  | "INPUT_TYPE_MISMATCH"
  | "UNKNOWN_INPUT"
  | "CALL_CYCLE"
  | "NESTING_TOO_DEEP";

export class SynthesisError extends Error {
  override readonly cause: unknown;
  readonly code: SynthesisErrorCode;
  readonly stepId?: string;

  constructor(
    code: SynthesisErrorCode,
    message: string,
    stepId?: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "SynthesisError";
    this.code = code;
    if (stepId !== undefined) {
      this.stepId = stepId;
    }
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

// ── Compat: old core error classes (used by sdk, checks until rebuilt) ──

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
