/**
 * Error class for check resolution and findings extraction failures.
 */
export class CheckError extends Error {
  readonly code: CheckErrorCode;
  override readonly cause: unknown;
  constructor(message: string, code: CheckErrorCode, cause?: unknown) {
    super(message);
    this.name = "CheckError";
    this.code = code;
    this.cause = cause;
  }
}

export type CheckErrorCode = "RESOLUTION_FAILED" | "EXTRACTION_FAILED";
