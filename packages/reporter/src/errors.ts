// @sverka/reporter — errors. Spec 43.

export type ReporterErrorCode = "COLLECTION_FAILED" | "RENDER_ERROR";

export class ReporterError extends Error {
  readonly code: ReporterErrorCode;
  override readonly cause: unknown;

  constructor(message: string, code: ReporterErrorCode, cause?: unknown) {
    super(message);
    this.name = "ReporterError";
    this.code = code;
    this.cause = cause;
  }
}
