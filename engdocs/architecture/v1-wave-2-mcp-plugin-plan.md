# v1 Wave 2 Plan — MCP Plugin Transport

**Spec:** 23-mcp-plugin
**Bead:** sv-wthn.2.1
**Packages:** `@sverka/compiler` (plugin facet), `@sverka/plugin-mcp` (new)
**Date:** 2026-08-31
**Base branch:** `v1-w2-mcp-ai` (stacks on Wave 1 branch)

## Scope

Add a `ToolProvider` facet to `SverkaPlugin` (in `@sverka/compiler`). Create
`@sverka/plugin-mcp` package that loads external MCP servers (stdio/HTTP)
and exposes their tools through the facet. Lazy connection, multi-server
namespacing, Streamable HTTP with SSE fallback.

## Package dependency

```text
@sverka/plugin-mcp  →  @sverka/compiler  (SverkaPlugin, ToolProvider types)
                      @modelcontextprotocol/sdk  (Client, transports)
```

`@sverka/compiler` gains NO new dependency. The MCP SDK dep is isolated in
the optional `@sverka/plugin-mcp` package (§29: optional plugins MUST NOT
be mandatory deps of core).

## Files

| File | Action |
|---|---|
| `packages/compiler/src/plugin/types.ts` | **Edit** — add `ToolProvider`, `ToolDefinition`, `ToolResult`, `ToolResultContent` interfaces; add `tools?: ToolProvider` to `SverkaPlugin`. |
| `packages/compiler/src/plugin/index.ts` | **Edit** — export the 4 new types. |
| `packages/compiler/src/plugin/factory.ts` | **Edit** — `snapshotPlugin` copies `tools` facet (shallow copy — the provider is a live object, not snapshotable). |
| `packages/compiler/src/plugin/__tests__/tools-facet.test.ts` | **New** — assert `SverkaPlugin` accepts `tools`, registry snapshots preserve it, types exported (items 10, 12). |
| `packages/plugin-mcp/` | **New package** — scaffold (package.json, project.json, tsconfig, tsdown.config, src/index.ts). |
| `packages/plugin-mcp/src/index.ts` | **New** — `createMCPPlugin`, `MCPPluginConfig`, `MCPServerConfig` types. |
| `packages/plugin-mcp/src/client.ts` | **New** — `MCPClientPool`: lazy connect, multi-server, transport selection (stdio/HTTP/SSE fallback), `listTools`/`callTool` proxying with name prefixing. |
| `packages/plugin-mcp/src/errors.ts` | **New** — `MCPPluginError` with `override cause`, 4 codes. |
| `packages/plugin-mcp/src/__tests__/client.test.ts` | **New** — unit tests with mocked MCP SDK `Client` (items 1–9). |
| `packages/plugin-mcp/src/__tests__/public-api.test.ts` | **New** — export assertions (item 11). |
| `package.json` (root) | **Edit** — add `packages/plugin-mcp` to workspaces if not glob-covered. |
| `bun.lock` | **Regenerate** — `bun install` after adding `@modelcontextprotocol/sdk`. |

## TDD steps

1. Add `ToolProvider` / `ToolDefinition` / `ToolResult` / `ToolResultContent`
   to `@sverka/compiler` plugin types + export. Write `tools-facet.test.ts`
   item 10 (types exported) + item 12 (plugin accepts `tools`).
2. Update `snapshotPlugin` to copy `tools` (shallow — live object).
3. Scaffold `@sverka/plugin-mcp` package (package.json with
   `@modelcontextprotocol/sdk` + `@sverka/compiler` deps, project.json,
   tsconfig, tsdown.config).
4. Write `errors.ts` — `MCPPluginError` with 4 codes, `override cause`.
5. Write `client.test.ts` item 1 (empty servers → empty listTools, no
   connect). Implement `MCPClientPool` skeleton until green.
6. Write item 2 (single stdio server: listTools + callTool with prefix).
   Mock MCP SDK `Client` via `vi.mock`. Implement proxying.
7. Write item 3 (lazy connect — no spawn at construction). Verify via mock
   that `Client.connect` is not called until first tool access.
8. Write item 4 (multi-server namespacing — `s1.foo`, `s2.foo`).
9. Write item 5 (unknown server → `TOOL_NOT_FOUND`).
10. Write item 6 (server returns `isError: true` → `TOOL_CALL_FAILED`).
11. Write item 7 (connect failure → `CONNECT_FAILED`).
12. Write item 8 (dispose + re-connect after dispose).
13. Write item 9 (HTTP: StreamableHTTP first, SSE fallback). Mock both
    transports.
14. Write `public-api.test.ts` item 11 (export assertions).
15. `bun install` (regenerates bun.lock with MCP SDK).
16. Run gates: `bun run test`, `bun run typecheck`, `bun run lint`,
    `bun run build`. All green.

## MCP SDK version

Use `@modelcontextprotocol/sdk` (the established package). Check
`npm view @modelcontextprotocol/sdk version` at build time and pin a version
published ≥7 days ago. The SDK provides:
- `Client` (from `@modelcontextprotocol/sdk/client/index.js`)
- `StdioClientTransport` (from `@modelcontextprotocol/sdk/client/stdio.js`)
- `StreamableHTTPClientTransport` (from `@modelcontextprotocol/sdk/client/streamableHttp.js`)
- `SSEClientTransport` (from `@modelcontextprotocol/sdk/client/sse.js`)

If the SDK has split into `@modelcontextprotocol/client` (v2), use that
instead — verify at build time.

## Mocking strategy

`vi.mock("@modelcontextprotocol/sdk/client/index.js")` and the transport
modules. Mock `Client` class with `connect`, `listTools`, `callTool`,
`close` methods. This avoids spawning real processes or opening HTTP
connections in tests.

## Commit hygiene

Stage ONLY `packages/compiler/src/plugin/**` (types.ts, index.ts,
factory.ts, tests) + `packages/plugin-mcp/**` (entire new package) +
`package.json` (workspaces, if edited) + `specs/23-mcp-plugin/spec.md` +
this plan + `bun.lock`. EXCLUDE city.toml, agents/, .devin/, .gc/, .beads/,
formulas/, engdocs/adr/.
