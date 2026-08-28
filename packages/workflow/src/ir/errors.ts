// Error classes for @sverka/ir.
// Spec 06 — Error handling.

export type IRErrorCode = "VALIDATION_ERROR" | "SERIALIZATION_ERROR";

export class IRError extends Error {
  override readonly cause: unknown;
  readonly code: IRErrorCode;

  constructor(
    message: string,
    code: IRErrorCode,
    cause?: unknown,
  ) {
    super(message);
    this.name = "IRError";
    this.code = code;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/** Raised when a graph or run plan fails schema or semantic validation. */
export class ValidationError extends IRError {
  constructor(message: string, cause?: unknown) {
    super(message, "VALIDATION_ERROR", cause);
    this.name = "ValidationError";
  }
}

/** Raised when JSON (de)serialization fails (malformed JSON, NaN/Infinity). */
export class SerializationError extends IRError {
  constructor(message: string, cause?: unknown) {
    super(message, "SERIALIZATION_ERROR", cause);
    this.name = "SerializationError";
  }
}
