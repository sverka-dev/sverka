// Construct error class. Spec 01 — Error handling.

export type ConstructErrorCode = "INVALID_SCOPE" | "DUPLICATE_ID" | "INVALID_OUTPUT";

export class ConstructError extends Error {
  override readonly cause: unknown;
  readonly code: ConstructErrorCode;

  constructor(code: ConstructErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "ConstructError";
    this.code = code;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}
