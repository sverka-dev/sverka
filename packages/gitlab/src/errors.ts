// GitLab target error class. Spec 09.

export type GitlabTargetErrorCode =
  | "INVALID_GRAPH"
  | "UNSUPPORTED_TRIGGER"
  | "LOWER_FAILED";

export class GitlabTargetError extends Error {
  readonly code: GitlabTargetErrorCode;
  override readonly cause: unknown;

  constructor(message: string, code: GitlabTargetErrorCode, cause?: unknown) {
    super(message);
    this.name = "GitlabTargetError";
    this.code = code;
    this.cause = cause;
  }
}
