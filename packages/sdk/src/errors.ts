// Error classes for @sverka/sdk. Spec 03 — Error handling.

export type SdkErrorCode =
  | "INVALID_INTERPOLATION"
  | "INVALID_IMAGE"
  // Legacy config-discovery codes retained while CLI migrates to the new SDK API.
  | "CONFIG_NOT_FOUND"
  | "CONFIG_LOAD_FAILED";

export class SdkError extends Error {
  override readonly cause?: unknown;
  readonly code: SdkErrorCode;

  constructor(message: string, code: SdkErrorCode, cause?: unknown) {
    super(message);
    this.name = "SdkError";
    this.code = code;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}
