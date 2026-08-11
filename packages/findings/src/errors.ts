/**
 * Base error class for normalization failures. All normalization errors throw
 * a `NormalizationError` with one of the `NormalizationErrorCode` values.
 */
export class NormalizationError extends Error {
  readonly code: NormalizationErrorCode;
  override readonly cause: unknown;
  constructor(
    message: string,
    code: NormalizationErrorCode,
    cause?: unknown,
  ) {
    super(message);
    this.name = "NormalizationError";
    this.code = code;
    this.cause = cause;
  }
}

export type NormalizationErrorCode =
  | "INVALID_SARIF"
  | "MISSING_LOCATION"
  | "INVALID_FINGERPRINT_INPUT";

/**
 * Base error class for baseline operation failures. All baseline I/O and
 * schema errors throw a `BaselineError` with one of the `BaselineErrorCode`
 * values.
 */
export class BaselineError extends Error {
  readonly code: BaselineErrorCode;
  override readonly cause: unknown;
  constructor(message: string, code: BaselineErrorCode, cause?: unknown) {
    super(message);
    this.name = "BaselineError";
    this.code = code;
    this.cause = cause;
  }
}

export type BaselineErrorCode =
  | "BASELINE_NOT_FOUND"
  | "BASELINE_INVALID"
  | "BASELINE_WRITE_FAILED";
