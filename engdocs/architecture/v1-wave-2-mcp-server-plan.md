# v1 Wave 2 Plan — Sverka MCP Server

**Spec:** 28-mcp-server
**Bead:** sv-wthn.2.3
**Package:** `@sverka/cli` (new `mcp-server` command)
**Date:** 2026-08-31
**Base branch:** `v1-w2-mcp-ai` (stacks on Wave 1)

## Scope

`sverka mcp-server` CLI command. Exposes 5 Sverka operations (validate,
plan, graph, run, synth) as MCP tools over stdio. Uses
`@modelcontextprotocol/sdk` server-side. Reuses existing CLI command
handlers with a buffering output writer.

## Package dependency

```text
@sverka/cli  →  @modelcontextprotocol/sdk  (McpServer, StdioServerTransport)
               @sverka/sdk, @sverka/runtime, @sverka/workflow  (existing — for command handlers)
```

The MCP SDK is already a dep of `@sverka/plugin-mcp` (Wave 2.1). For
`@sverka/cli`, it's a new direct dep.

## Files

| File | Action |
|---|---|
| `packages/cli/src/commands/mcp-server.ts` | **New** — `mcpServerCommand`: starts MCP server, registers 5 tools, connects stdio transport. |
| `packages/cli/src/internal/mcp-tools.ts` | **New** — `SverkaMcpTool` interface + 5 tool definitions mapping to CLI command handlers. |
| `packages/cli/src/internal/buffering-writer.ts` | **New** — `BufferingOutputWriter` (captures structured output; logs to stderr, NOT stdout). |
| `packages/cli/src/main.ts` | **Edit** — register `mcp-server` command in yargs + dispatch. |
| `packages/cli/src/types.ts` | **Edit** — export `McpServerArgs` (if commands are typed). |
| `packages/cli/package.json` | **Edit** — add `@modelcontextprotocol/sdk` dep. |
| `packages/cli/src/__tests__/mcp-server.test.ts` | **New** — server lifecycle + tool tests (items 1–10). |
| `bun.lock` | **Regenerate** — `bun install` after adding MCP SDK dep. |

## TDD steps

1. Add `@modelcontextprotocol/sdk` to cli package.json; `bun install`.
2. Write `buffering-writer.ts` — `BufferingOutputWriter` that writes logs
   to stderr and buffers structured results. Test: writes go to stderr,
   not stdout.
3. Write `mcp-tools.ts` — `SverkaMcpTool` interface + 5 tool definitions.
   Each tool's `run()` calls the existing command handler with a
   `BufferingOutputWriter` and returns the structured result. Test: tool
   definitions have correct names + schemas (item 3 — `tools/list`).
4. Write `mcp-server.ts` — `mcpServerCommand`: creates `McpServer`,
   registers tools, connects `StdioServerTransport`, awaits shutdown.
5. Write test item 1 (`--help` prints tool descriptions, exits 0).
6. Write test item 2 (server responds to MCP `initialize` handshake). Use
   `vi.mock` for stdio transport or spawn the binary with piped stdin/
   stdout and send raw JSON-RPC.
7. Write test item 4 (`tools/call sverka.validate` returns structured
   result). Use a test project fixture.
8. Write test item 5 (`tools/call sverka.run` returns status + duration).
9. Write test item 6 (invalid args → MCP SDK rejects via zod schema).
10. Write test item 7 (command handler failure → `isError: true`).
11. Write test item 8 (stdin close → clean shutdown, exit 0).
12. Write test item 9 (no stdout pollution — logs to stderr only).
13. Register in `main.ts` (item 10).
14. Run gates: `bun run test`, `bun run typecheck`, `bun run lint`,
    `bun run build`. All green.

## Testing strategy

Two options:
- **Unit**: `vi.mock("@modelcontextprotocol/sdk/server/mcp.js")` — mock
  `McpServer` to capture registered tools and simulate `tools/call`. Fast,
  no subprocess.
- **Integration**: spawn `node dist/bin.mjs mcp-server` with piped stdio,
  send JSON-RPC `initialize` + `tools/list` + `tools/call` messages, parse
  responses. More realistic but slower.

Prefer unit tests for items 3–10; use integration test for items 2, 8
(handshake + shutdown). Gate the integration test behind `SVERKA_MCP` env
var (like runtime-docker integration tests).

## MCP SDK version

Same as Wave 2.1 — use `@modelcontextprotocol/sdk` (or
`@modelcontextprotocol/server` if v2 split). Verify at build time, pin a
version published ≥7 days ago.

## Commit hygiene

Stage ONLY `packages/cli/src/commands/mcp-server.ts` +
`packages/cli/src/internal/mcp-tools.ts` +
`packages/cli/src/internal/buffering-writer.ts` + `packages/cli/src/main.ts`
+ `packages/cli/src/types.ts` + `packages/cli/src/__tests__/mcp-server.test.ts`
+ `packages/cli/package.json` + `specs/28-mcp-server/spec.md` + this plan +
`bun.lock`. EXCLUDE city.toml, agents/, .devin/, .gc/, .beads/, formulas/,
engdocs/adr/.
