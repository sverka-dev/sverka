// Plugin error class. Spec 07.

export type PluginErrorCode =
  | "INVALID_PLUGIN"
  | "DUPLICATE_PLUGIN"
  | "INVALID_CAPABILITY";

export class PluginError extends Error {
  readonly code: PluginErrorCode;
  override readonly cause: unknown;

  constructor(message: string, code: PluginErrorCode, cause?: unknown) {
    super(message);
    this.name = "PluginError";
    this.code = code;
    this.cause = cause;
  }
}
