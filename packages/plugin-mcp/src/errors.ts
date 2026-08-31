// MCP plugin errors. Spec 23 — §"Error handling".

export type MCPPluginErrorCode =
  | "CONNECT_FAILED"
  | "TOOL_NOT_FOUND"
  | "TOOL_CALL_FAILED"
  | "TRANSPORT_ERROR";

export class MCPPluginError extends Error {
  override readonly cause: unknown;

  constructor(message: string, code: MCPPluginErrorCode, cause?: unknown) {
    super(message);
    this.name = "MCPPluginError";
    this.code = code;
    this.cause = cause;
  }

  readonly code: MCPPluginErrorCode;
}
