/**
 * Error thrown for SDK configuration and execution errors.
 */
export class SdkError extends Error {
  readonly code: SdkErrorCode;
  override readonly cause: unknown;
  constructor(message: string, code: SdkErrorCode, cause?: unknown) {
    super(message);
    this.name = "SdkError";
    this.code = code;
    this.cause = cause;
  }
}

/** SDK error codes. */
export type SdkErrorCode =
  | "CONFIG_NOT_FOUND"
  | "CONFIG_INVALID"
  | "CONFIG_LOAD_FAILED"
  | "CONFIG_PATH_ESCAPE"
  | "EXECUTION_FAILED";
