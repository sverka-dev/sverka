// Temporal target error class. Spec 33.

export type TemporalTargetErrorCode =
  | "INVALID_GRAPH"
  | "LOWER_FAILED"
  | "EMIT_FAILED";

export class TemporalTargetError extends Error {
  readonly code: TemporalTargetErrorCode;
  override readonly cause: unknown;

  constructor(message: string, code: TemporalTargetErrorCode, cause?: unknown) {
    super(message);
    this.name = "TemporalTargetError";
    this.code = code;
    this.cause = cause;
  }
}
