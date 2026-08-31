# Spec 28 — Sverka MCP Server

**Status:** Active
**Source:** specs/architecture-spec.md §30 (CLI), §17 (Plugin Architecture), §21 (Engine Contract)
**Package:** `@sverka/cli` (new `mcp-server` command), `@sverka/plugin-mcp` (no change — consumed by 2.1)
**Bead:** sv-wthn.2.3
**Depends on:** sv-wthn.2.1 (MCP plugin — `ToolProvider` types)
**Related:** Spec 17 (CLI), Spec 23 (MCP plugin), Spec 27 (AgentStep — consumer of MCP tools)

## Overview

`sverka mcp-server` exposes Sverka operations (plan, run, validate, synth,
graph) as MCP tools. External AI agents (Claude, Copilot, GPT) can invoke
Sverka workflows via the Model Context Protocol — the agent calls
`sverka.plan` or `sverka.run` as a tool, and Sverka executes locally. This
makes Sverka an **MCP server**: any MCP-compatible client can drive it.

Uses `@modelcontextprotocol/sdk` server-side (`McpServer` + `StdioServerTransport`).
The server runs over stdio (the standard transport for local CLI MCP
servers). No HTTP transport in v1 (follow-up).

Inspired by gh-aw mcp-server command.

## Goals

- `sverka mcp-server` CLI command: starts an MCP server over stdio.
- 5 MCP tools exposed: `sverka.validate`, `sverka.plan`, `sverka.graph`,
  `sverka.run`, `sverka.synth`.
- Each tool maps to the corresponding CLI command logic (reuses existing
  command handlers, returns structured JSON instead of human text).
- `McpServer` from `@modelcontextprotocol/sdk` with `StdioServerTransport`.
- Tool input schemas: JSON Schema objects describing each tool's args
  (e.g. `sverka.run` takes `{ entryId?: string, executor?: "host"|"docker" }`).
- Tool output: MCP `CallToolResult` with text content (JSON string of the
  command's structured result).
- Graceful shutdown on stdin close / SIGTERM.
- `--help` documents the exposed tools.

## Non-goals

- HTTP/SSE transport for the MCP server — v1 is stdio only (standard for
  local CLI MCP servers). HTTP is a follow-up.
- Exposing Sverka as an MCP resource (only tools) — follow-up.
- Exposing individual workflow steps as MCP tools — out of scope; the
  tools are the 5 CLI operations.
- Authentication / multi-tenant — v1 is local single-user.
- Streaming tool results (progress) — follow-up; v1 returns complete
  results.
- Configuring which tools to expose — v1 exposes all 5 unconditionally.

## Interfaces

### CLI (`@sverka/cli`)

```ts
// packages/cli/src/commands/mcp-server.ts

export interface McpServerArgs {
  // no args in v1 — stdio transport, all tools exposed
}

export async function mcpServerCommand(
  args: McpServerArgs,
  global: GlobalFlags,
  output: OutputWriter,
  start: number,
): Promise<number>;
```

Registered in `main.ts` as `.command("mcp-server", "Expose Sverka as an MCP server (stdio)")`.

### MCP tool definitions

```ts
interface SverkaMcpTool {
  readonly name: string;          // "sverka.validate", "sverka.plan", etc.
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>; // JSON Schema
  run(args: Readonly<Record<string, unknown>>): Promise<unknown>; // returns structured result
}
```

The 5 tools:

| Tool | Input schema | Output |
|---|---|---|
| `sverka.validate` | `{ root?: string }` | `{ valid: boolean, errors: string[] }` |
| `sverka.plan` | `{ root?: string, entryId?: string }` | `{ planId: string, steps: number }` |
| `sverka.graph` | `{ root?: string }` | `{ pipelines: string[], steps: number, edges: number }` |
| `sverka.run` | `{ root?: string, entryId?: string, executor?: "host"\|"docker" }` | `{ status: "success"\|"failure"\|"cancelled", durationMs: number }` |
| `sverka.synth` | `{ root?: string, target: "github"\|"gitlab" }` | `{ artifacts: { path: string }[] }` |

### MCP SDK usage

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "sverka", version: "0.0.0" });
for (const tool of sverkaTools) {
  server.tool(tool.name, tool.description, tool.inputSchema, async (args) => {
    const result = await tool.run(args);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });
}
const transport = new StdioServerTransport();
await server.connect(transport);
```

## Data models

### Tool → command handler mapping

Each `SverkaMcpTool.run` calls the existing CLI command handler
(`validateCommand`, `planCommand`, etc.) with a captured `OutputWriter`
(that buffers JSON instead of printing to stdout — stdout is reserved for
MCP JSON-RPC). The handler's exit code maps to the tool result: exit 0 →
success result; non-zero → MCP `isError: true` with the error message.

### OutputWriter isolation

The MCP server MUST NOT write to stdout (stdout is the MCP transport). The
`OutputWriter` passed to command handlers writes to stderr (human-readable
logs) or buffers (structured results). A `BufferingOutputWriter` captures
the structured result for the tool response.

## Error handling

- Command handler failure (non-zero exit): tool returns
  `{ content: [{ type: "text", text: error.message }], isError: true }`.
- Invalid tool args (schema validation): MCP SDK rejects before calling
  `run` (built-in `zod` validation).
- Server startup failure (stdio unavailable): `mcpServerCommand` returns
  exit code 1.
- No new error class — reuses `CliError` from existing CLI errors.

## Test plan

1. `sverka mcp-server --help` prints tool descriptions and exits 0.
2. Server starts, responds to MCP `initialize` request (handshake).
3. `tools/list` returns 5 tools with correct names + schemas.
4. `tools/call sverka.validate` with `{ root: "/path" }` returns
   `{ valid: true, errors: [] }` (against a valid project).
5. `tools/call sverka.run` with `{ entryId: "ci" }` returns
   `{ status: "success", durationMs: <n> }` (against a test project).
6. `tools/call sverka.run` with invalid `executor: "podman"` → MCP SDK
   rejects (schema validation, zod).
7. Command handler failure → tool result with `isError: true`.
8. Server shuts down on stdin close (clean exit, code 0).
9. No stdout pollution: command handler logs go to stderr, not stdout
   (stdout is MCP transport only).
10. `mcpServerCommand` registered in `main.ts` dispatch.
11. `McpServerArgs` exported from `@sverka/cli` (or internal — not public
    API if CLI commands are not exported).
