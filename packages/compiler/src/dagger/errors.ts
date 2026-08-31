// Dagger target error class. Spec 34.

export type DaggerTargetErrorCode =
  | "INVALID_GRAPH"
  | "LOWER_FAILED"
  | "EMIT_FAILED"
  | "UNSUPPORTED_RUNTIME";

export class DaggerTargetError extends Error {
  readonly code: DaggerTargetErrorCode;
  override readonly cause: unknown;

  constructor(message: string, code: DaggerTargetErrorCode, cause?: unknown) {
    super(message);
    this.name = "DaggerTargetError";
    this.code = code;
    this.cause = cause;
  }
}
