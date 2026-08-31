// mcp-server command — expose Sverka operations as MCP tools over stdio.
// Spec 28 — sverka mcp-server.

import process from "node:process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { GlobalFlags, OutputWriter } from "../types.js";
import { ExitCode } from "../types.js";
import { registerSverkaTools } from "../internal/mcp-tools.js";

/** Args for the mcp-server command (none in v1 — stdio transport, all tools exposed). */
export interface McpServerArgs {}

/**
 * Start an MCP server over stdio that exposes Sverka operations as tools.
 * External AI agents can invoke sverka.validate, sverka.plan, sverka.graph,
 * sverka.run, and sverka.synth via the Model Context Protocol.
 *
 * The server runs until stdin closes or SIGTERM is received. stdout is
 * reserved for MCP JSON-RPC transport — all logs go to stderr.
 *
 * @param shutdownSignal Optional promise that resolves to signal shutdown
 *   (for testing). In production, the server waits for stdin close / SIGTERM.
 */
export async function mcpServerCommand(
  _args: McpServerArgs,
  global: GlobalFlags,
  output: OutputWriter,
  _start: number,
  shutdownSignal?: Promise<void>,
): Promise<number> {
  output.debug(`mcp-server: root=${global.root}`);

  const server = new McpServer({ name: "sverka", version: "0.0.0" });
  registerSverkaTools(server, global.root);

  const transport = new StdioServerTransport();

  try {
    await server.connect(transport);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    output.errorLine(`mcp-server: failed to start: ${msg}`);
    return ExitCode.RuntimeError;
  }

  // Wait for shutdown signal (stdin close / SIGTERM in production,
  // or an injected promise in tests).
  await (shutdownSignal ?? waitForStdinClose());

  await server.close();
  return ExitCode.Success;
}

/** Wait for stdin close or SIGTERM. */
function waitForStdinClose(): Promise<void> {
  return new Promise<void>((resolve) => {
    const cleanup = (): void => {
      process.stdin.off("end", cleanup);
      process.stdin.off("close", cleanup);
      process.off("SIGTERM", cleanup);
      resolve();
    };
    process.stdin.on("end", cleanup);
    process.stdin.on("close", cleanup);
    process.on("SIGTERM", cleanup);
  });
}
