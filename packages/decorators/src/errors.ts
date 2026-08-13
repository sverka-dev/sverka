// Decorator error class. Spec 04.

export type DecoratorErrorCode =
  | "INVALID_FIELD"
  | "MISSING_INITIALIZER"
  | "INVALID_OPTIONS"
  | "DUPLICATE_FIELD"
  | "NOT_A_PIPELINE";

export class DecoratorError extends Error {
  readonly code: DecoratorErrorCode;
  override readonly cause: unknown;

  constructor(message: string, code: DecoratorErrorCode, cause?: unknown) {
    super(message);
    this.name = "DecoratorError";
    this.code = code;
    this.cause = cause;
  }
}
