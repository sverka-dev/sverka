/**
 * Error thrown for policy configuration and evaluation errors. All policy
 * errors throw a `PolicyError` with one of the `PolicyErrorCode` values.
 */
export class PolicyError extends Error {
  readonly code: PolicyErrorCode;
  override readonly cause: unknown;
  constructor(message: string, code: PolicyErrorCode, cause?: unknown) {
    super(message);
    this.name = "PolicyError";
    this.code = code;
    this.cause = cause;
  }
}

/** Policy error codes. */
export type PolicyErrorCode = "INVALID_POLICY" | "INVALID_SEVERITY";
