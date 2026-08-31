# Spec 23 — MCP Plugin Transport

**Status:** Active
**Source:** specs/architecture-spec.md §17 (Plugin Architecture), §17.2 (Plugin facets), §29 (package layout)
**Package:** `@sverka/plugin-mcp` (new, optional)
**Bead:** sv-wthn.2.1
**Related:** Spec 07 (plugin + capability model), sv-wthn.2.2 (AgentStep — consumer)

## Overview

Load external MCP (Model Context Protocol) servers as Sverka plugins. A
`createMCPPlugin(config)` adapter connects to one or more MCP servers over
stdio or Streamable HTTP (with SSE fallback), discovers their tools, and
exposes them through a new `tools` facet on `SverkaPlugin`. The facet
implements `ToolProvider` — a runtime interface for listing and calling
tools. AgentStep (sv-wthn.2.2) is the consumer; this spec does not add a
new operation kind to the Definition Graph.

Inspired by gh-aw MCP Gateway + Mastra MCPClient. Enables language-agnostic
plugins: any tool exposed via MCP (Python, Go, Rust servers) becomes
callable from a Sverka workflow without a native TypeScript adapter.

## Goals

- `ToolProvider` facet added to `SverkaPlugin` (in `@sverka/compiler` plugin
  types): `listTools()` + `callTool(name, args)`.
- `ToolDefinition` / `ToolResult` types (MCP tool shape, provider-agnostic).
- `@sverka/plugin-mcp` package: `createMCPPlugin(config)` returns a
  `SverkaPlugin` with a `tools` facet proxying to MCP `Client`.
- `MCPServerConfig` union: stdio (`{ command, args?, env?, cwd? }`) and
  HTTP (`{ url }` — Streamable HTTP with SSE fallback).
- Multi-server: one plugin can front N named MCP servers; tool names are
  prefixed with the server name (`<server>.<tool>`) to avoid collisions.
- Connection lifecycle: `connect()` on first tool call (lazy), `dispose()`
  closes all clients.
- `mcp.tools.<capability>` entries in the plugin capability manifest
  (`native` for tool listing/calling; transport-specific notes).

## Non-goals

- AgentStep (the step type that calls tools) — sv-wthn.2.2, separate spec.
- New `OperationDefinition` kind for MCP — not added; tools are called by
  AgentStep at runtime, not synthesized into the Definition Graph.
- MCP resources / prompts — tools only (sv-wthn.2.2 needs tools; resources
  and prompts are follow-up).
- MCP server implementation (exposing Sverka AS a server) — sv-wthn.2.3.
- Plugin auto-loading from npm — explicit registration only (matches Spec 07
  non-goal).
- Authentication / OAuth for HTTP transports — follow-up (MCP SDK supports
  it; config can carry tokens later).
- Tool result schema validation — caller's responsibility (AgentStep).

## Interfaces

### Plugin facet (added to `@sverka/compiler` plugin types)

```ts
// packages/compiler/src/plugin/types.ts — NEW facet

export interface ToolDefinition {
  readonly name: string;          // "<server>.<tool>" — globally unique within plugin
  readonly description?: string;
  readonly inputSchema?: Readonly<Record<string, unknown>>; // JSON Schema
}

export interface ToolResult {
  readonly content: readonly ToolResultContent[];
  readonly isError?: boolean;
}

export type ToolResultContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string }
  | { readonly type: "resource"; readonly resource: { readonly uri: string; readonly mimeType?: string } };

export interface ToolProvider {
  listTools(): Promise<readonly ToolDefinition[]>;
  callTool(name: string, args?: Readonly<Record<string, unknown>>): Promise<ToolResult>;
  dispose?(): Promise<void>;
}
```

`SverkaPlugin` gains `readonly tools?: ToolProvider;`.

### MCP plugin (`@sverka/plugin-mcp`)

```ts
// packages/plugin-mcp/src/index.ts

export type MCPServerConfig =
  | { readonly name: string; readonly transport: "stdio"; readonly command: string; readonly args?: readonly string[]; readonly env?: Readonly<Record<string, string>>; readonly cwd?: string }
  | { readonly name: string; readonly transport: "http"; readonly url: string };

export interface MCPPluginConfig {
  readonly servers: readonly MCPServerConfig[];
}

function createMCPPlugin(config: MCPPluginConfig): SverkaPlugin & { readonly tools: ToolProvider };
```

The returned plugin:
- `name`: `"mcp"` (or derived from config if single server).
- `apiVersion`: `"sverka.dev/v1"`.
- `capabilities`: `{ "mcp.tools.list": "native", "mcp.tools.call": "native" }`.
- `tools`: a `ToolProvider` that lazily connects to all configured servers
  on first `listTools()`/`callTool()`, proxies calls, and prefixes tool
  names with `<server>.<tool>`.

## Data models

### Tool name namespacing

Each MCP server in `MCPPluginConfig` has a `name`. Tools discovered from
that server are exposed as `<serverName>.<toolName>`. `callTool("<server>.<tool>", args)`
routes to the correct server's `Client.callTool({ name: "<tool>", arguments: args })`.

### Connection lifecycle

- Lazy: `Client.connect(transport)` is called on first access (either
  `listTools` or `callTool`), not at `createMCPPlugin` time. This avoids
  spawning processes / opening connections for plugins that are registered
  but never used.
- `dispose()`: closes all connected clients (MCP SDK `client.close()`).
  Safe to call multiple times; no-op for never-connected servers.

### Transport selection

- `transport: "stdio"` → `StdioClientTransport({ command, args, env, cwd })`.
- `transport: "http"` → try `StreamableHTTPClientTransport(new URL(url))`;
  on failure (4xx), fall back to `SSEClientTransport(new URL(url))` on a
  fresh `Client` (per MCP SDK guidance).

## Error handling

- `MCPPluginError` (new, in `@sverka/plugin-mcp`): `override readonly cause`.
  Codes:
  - `CONNECT_FAILED` — `Client.connect()` threw (server not found, refused).
  - `TOOL_NOT_FOUND` — `callTool` name doesn't match `<server>.<tool>` or
    server not configured.
  - `TOOL_CALL_FAILED` — MCP server returned `isError: true` or threw.
  - `TRANSPORT_ERROR` — transport-level failure (process exited, HTTP 5xx).
- `listTools()` / `callTool()` failures throw `MCPPluginError` (not silent).
  The caller (AgentStep) decides whether to retry or fail the step.
- `dispose()` is best-effort: catches and ignores per-client close errors.

## Test plan

1. `createMCPPlugin({ servers: [] })` returns a plugin with `name: "mcp"`,
   empty `listTools()` → `[]`, no connections opened.
2. Single stdio server: `listTools()` connects, returns tools prefixed
   `<server>.<tool>`; `callTool("<server>.<tool>", args)` proxies to the
   server. (Use a mock MCP server or `vi.mock` the SDK `Client`.)
3. Lazy connect: `createMCPPlugin` does NOT spawn a process; the process is
   spawned only on first `listTools()` or `callTool()`.
4. Multi-server: two servers, tool names don't collide (`s1.foo`, `s2.foo`).
5. `callTool` with unknown server prefix → `MCPPluginError(TOOL_NOT_FOUND)`.
6. `callTool` where server returns `isError: true` → `MCPPluginError(TOOL_CALL_FAILED)`.
7. Connect failure (bad command) → `MCPPluginError(CONNECT_FAILED)`.
8. `dispose()` closes all clients; calling `listTools()` after dispose
   re-connects (lazy).
9. HTTP transport: `StreamableHTTPClientTransport` tried first; on failure,
   `SSEClientTransport` fallback succeeds. (Mock both.)
10. `ToolProvider`, `ToolDefinition`, `ToolResult`, `ToolResultContent`
    exported from `@sverka/compiler` (the facet lives in the plugin types).
11. `createMCPPlugin`, `MCPPluginConfig`, `MCPServerConfig`, `MCPPluginError`
    exported from `@sverka/plugin-mcp`.
12. The returned plugin satisfies `SverkaPlugin` (has `name`, `apiVersion`,
    `capabilities`, `tools`).
