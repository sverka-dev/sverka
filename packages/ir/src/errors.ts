/**
 * Base error class for the ir package. All IR errors extend this so callers
 * can catch the full family with a single `instanceof IRError`.
 */
export class IRError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "IRError";
  }
}

/** Raised when a Plan fails schema validation. */
export class ValidationError extends IRError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "VALIDATION_ERROR", context);
    this.name = "ValidationError";
  }
}

/** Raised when Plan (de)serialization fails (malformed JSON, parse errors). */
export class SerializationError extends IRError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "SERIALIZATION_ERROR", context);
    this.name = "SerializationError";
  }
}
