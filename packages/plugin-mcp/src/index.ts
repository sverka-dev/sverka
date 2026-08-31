// @sverka/plugin-mcp — MCP plugin transport. Spec 23.
//
// Loads external MCP (Model Context Protocol) servers as Sverka plugins.
// `createMCPPlugin(config)` returns a SverkaPlugin with a `tools` facet that
// lazily connects to one or more MCP servers (stdio or Streamable HTTP with
// SSE fallback) and exposes their tools with `<server>.<tool>` namespacing.

import type { SverkaPlugin, ToolProvider } from "@sverka/compiler";
import { MCPClientPool } from "./client.js";
import { MCPPluginError } from "./errors.js";

export { MCPClientPool } from "./client.js";
export { MCPPluginError, type MCPPluginErrorCode } from "./errors.js";

export type MCPServerConfig =
  | {
      readonly name: string;
      readonly transport: "stdio";
      readonly command: string;
      readonly args?: readonly string[];
      readonly env?: Readonly<Record<string, string>>;
      readonly cwd?: string;
    }
  | {
      readonly name: string;
      readonly transport: "http";
      readonly url: string;
    };

export interface MCPPluginConfig {
  readonly servers: readonly MCPServerConfig[];
}

/**
 * Create a Sverka plugin that fronts one or more MCP servers. The returned
 * plugin exposes a `tools` facet (ToolProvider) that lazily connects to the
 * configured servers on first tool access. Tool names are namespaced
 * `<server>.<tool>` to avoid collisions across servers.
 */
export function createMCPPlugin(
  config: MCPPluginConfig,
): SverkaPlugin & { readonly tools: ToolProvider } {
  const pool = new MCPClientPool(config.servers);
  const name = config.servers.length === 1 ? config.servers[0]?.name ?? "mcp" : "mcp";
  return {
    name,
    apiVersion: "sverka.dev/v1",
    capabilities: {
      "mcp.tools.list": "native",
      "mcp.tools.call": "native",
    },
    tools: pool,
  };
}
