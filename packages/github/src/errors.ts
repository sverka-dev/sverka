// GitHub target error class. Spec 08.

export type GithubTargetErrorCode =
  | "INVALID_GRAPH"
  | "UNSUPPORTED_TRIGGER"
  | "UNSUPPORTED_FEATURE"
  | "LOWER_FAILED"
  | "LOWERING_ERROR"
  | "IMPORT_FAILED"
  | "INVALID_MATRIX";

export class GithubTargetError extends Error {
  readonly code: GithubTargetErrorCode;
  override readonly cause: unknown;

  constructor(message: string, code: GithubTargetErrorCode, cause?: unknown) {
    super(message);
    this.name = "GithubTargetError";
    this.code = code;
    this.cause = cause;
  }
}
