// MCP client pool — lazy connect, multi-server namespacing, transport selection.
// Spec 23 — §"Data models", §"Connection lifecycle", §"Transport selection".

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { ToolDefinition, ToolResult, ToolProvider } from "@sverka/compiler";
import { MCPPluginError } from "./errors.js";
import type { MCPServerConfig } from "./index.js";

interface ServerEntry {
  readonly config: MCPServerConfig;
  client?: Client;
  connected: boolean;
}

/**
 * Pool of MCP clients, one per configured server. Connections are lazy:
 * a server's `Client.connect()` runs only on first access (listTools or
 * callTool). Tool names are namespaced `<server>.<tool>`.
 */
export class MCPClientPool implements ToolProvider {
  private readonly entries = new Map<string, ServerEntry>();

  constructor(servers: readonly MCPServerConfig[]) {
    for (const config of servers) {
      this.entries.set(config.name, { config, connected: false });
    }
  }

  async listTools(): Promise<readonly ToolDefinition[]> {
    const all: ToolDefinition[] = [];
    for (const entry of this.entries.values()) {
      const client = await this.ensureConnected(entry);
      const response = await client.listTools();
      for (const tool of response.tools) {
        all.push({
          name: `${entry.config.name}.${tool.name}`,
          ...(tool.description !== undefined ? { description: tool.description } : {}),
          ...(tool.inputSchema !== undefined
            ? { inputSchema: tool.inputSchema as Readonly<Record<string, unknown>> }
            : {}),
        });
      }
    }
    return all;
  }

  async callTool(
    name: string,
    args?: Readonly<Record<string, unknown>>,
  ): Promise<ToolResult> {
    const { serverName, toolName } = splitNamespaced(name);
    const entry = this.entries.get(serverName);
    if (!entry) {
      throw new MCPPluginError(
        `unknown MCP server '${serverName}' for tool '${name}'`,
        "TOOL_NOT_FOUND",
      );
    }
    const client = await this.ensureConnected(entry);
    let response;
    try {
      response = await client.callTool({ name: toolName, arguments: args });
    } catch (err) {
      throw new MCPPluginError(
        `MCP server '${serverName}' tool '${toolName}' call failed`,
        "TOOL_CALL_FAILED",
        err,
      );
    }
    if (response.isError) {
      throw new MCPPluginError(
        `MCP server '${serverName}' tool '${toolName}' returned an error`,
        "TOOL_CALL_FAILED",
      );
    }
    return {
      content: response.content as ToolResult["content"],
      ...(response.isError !== undefined ? { isError: response.isError } : {}),
    };
  }

  async dispose(): Promise<void> {
    for (const entry of this.entries.values()) {
      if (entry.connected && entry.client) {
        try {
          await entry.client.close();
        } catch {
          // best-effort: ignore per-client close errors (Spec 23).
        }
      }
      entry.client = undefined;
      entry.connected = false;
    }
  }

  private async ensureConnected(entry: ServerEntry): Promise<Client> {
    if (entry.connected && entry.client) {
      return entry.client;
    }
    const client = await connectServer(entry.config);
    entry.client = client;
    entry.connected = true;
    return client;
  }
}

function splitNamespaced(name: string): { serverName: string; toolName: string } {
  const dot = name.indexOf(".");
  if (dot < 0) {
    throw new MCPPluginError(
      `tool name '${name}' is not namespaced as '<server>.<tool>'`,
      "TOOL_NOT_FOUND",
    );
  }
  return { serverName: name.slice(0, dot), toolName: name.slice(dot + 1) };
}

/**
 * Create a connected Client for a server config. Selects the transport and
 * runs `Client.connect()`. Throws `MCPPluginError(CONNECT_FAILED)` on failure.
 * For HTTP servers, Streamable HTTP is tried first; on any connect failure it
 * falls back to SSE on a fresh client (Spec 23 — §"Transport selection").
 */
async function connectServer(config: MCPServerConfig): Promise<Client> {
  if (config.transport === "stdio") {
    const transport = new StdioClientTransport({
      command: config.command,
      ...(config.args !== undefined ? { args: [...config.args] } : {}),
      ...(config.env !== undefined ? { env: { ...config.env } } : {}),
      ...(config.cwd !== undefined ? { cwd: config.cwd } : {}),
    });
    return connectClient(config.name, transport);
  }
  // HTTP: try Streamable HTTP first, fall back to SSE on a fresh client.
  const url = new URL(config.url);
  try {
    const transport = new StreamableHTTPClientTransport(url);
    return await connectClient(config.name, transport);
  } catch {
    // Streamable HTTP failed (e.g. 4xx) — retry with SSE on a fresh client.
    const sseTransport = new SSEClientTransport(url);
    return connectClient(config.name, sseTransport);
  }
}

async function connectClient(name: string, transport: unknown): Promise<Client> {
  const client = new Client(
    { name: "sverka-mcp", version: "0.0.0" },
    { capabilities: {} },
  );
  try {
    await client.connect(transport as Parameters<typeof client.connect>[0]);
  } catch (err) {
    throw new MCPPluginError(
      `failed to connect to MCP server '${name}'`,
      "CONNECT_FAILED",
      err,
    );
  }
  return client;
}
