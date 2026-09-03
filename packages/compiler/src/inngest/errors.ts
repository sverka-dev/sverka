// Inngest target error class. Spec 35.

export type InngestTargetErrorCode =
  | "INVALID_GRAPH"
  | "LOWER_FAILED"
  | "EMIT_FAILED";

export class InngestTargetError extends Error {
  readonly code: InngestTargetErrorCode;
  override readonly cause: unknown;

  constructor(message: string, code: InngestTargetErrorCode, cause?: unknown) {
    super(message);
    this.name = "InngestTargetError";
    this.code = code;
    this.cause = cause;
  }
}
