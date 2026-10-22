# Sverka MCP Server

Sverka exposes its operations as MCP (Model Context Protocol) tools. Any
MCP-compatible client — Claude, Copilot, GPT, custom agents — can invoke
Sverka workflows through the standard MCP tool interface.

## Two MCP directions

Sverka supports MCP in both directions:

1. **Sverka as MCP server** — `sverka mcp-server` exposes Sverka operations
   (validate, plan, graph, run, synth) as MCP tools. External agents call
   `sverka.run` or `sverka.plan` as a tool, and Sverka executes locally.
2. **Sverka as MCP client** — `@sverka/plugin-mcp` loads external MCP servers
   as Sverka plugins. Workflow steps can call tools from any MCP server
   (GitHub, Slack, databases) via the `mcp.<server>.<tool>` namespace.

## Sverka as MCP server

```bash
sverka mcp-server
```

Starts an MCP server over stdio. The server exposes 5 tools:

| Tool              | Input                                                  | Output                                                                                                      |                                       |            |              |                                |
| ----------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---------- | ------------ | ------------------------------ |
| `sverka.validate` | `{ root?: string }`                                    | `{ path: string, valid: boolean, pipelines: number }`                                                       |                                       |            |              |                                |
| `sverka.plan`     | `{ root?: string, entryId?: string }`                  | `{ id: string, graphId: string, entry: { id: string, trigger: object }, steps: string[], inputs: unknown }` |                                       |            |              |                                |
| `sverka.graph`    | `{ root?: string }`                                    | Full DefinitionGraph object (pipelines, entries, steps, edges)                                              |                                       |            |              |                                |
| `sverka.run`      | `{ root?: string, entryId?: string, executor?: "host"\ | "docker" }`                                                                                                 | `{ planId: string, status: "success"\ | "failure"\ | "cancelled"\ | "suspended", events: number }` |
| `sverka.synth`    | `{ root?: string, target: "github"\                    | "gitlab" }`                                                                                                 | `{ artifacts: { path: string }[] }`   |            |              |                                |

The server runs until stdin closes or SIGTERM is received. stdout is
reserved for MCP JSON-RPC transport — all logs go to stderr.

### Configuration

Add Sverka to your MCP client config (e.g. Claude Desktop):

```json
{
  "mcpServers": {
    "sverka": {
      "command": "sverka",
      "args": ["mcp-server"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

The agent can now call `sverka.run` to execute your workflow, `sverka.plan`
to see what would run, or `sverka.validate` to check the workflow definition.

## Sverka as MCP client

The `@sverka/plugin-mcp` package (Spec 23) lets workflows call external
MCP servers. `createMCPPlugin(config)` returns a `SverkaPlugin` with a
`tools` facet (`ToolProvider`: `listTools()` + `callTool(name, args)` +
`dispose()`) that lazily connects to the configured servers on first
tool access. This is used by `AgentStep` — an AI agent step can be given
tools from any MCP server.

```ts
import { createMCPPlugin } from "@sverka/plugin-mcp";
import { AgentStep } from "@sverka/workflow";

const githubMcp = createMCPPlugin({
  servers: [
    {
      name: "github",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? "" }, // Never hardcode tokens — use secret management (env vars, vault)
    },
  ],
});

// Agent step with GitHub MCP tools
new AgentStep(pipeline, "review-pr", {
  engine: "claude",
  prompt: "Review the PR and post comments",
  tools: [{ plugin: "github", tool: "github.create-comment" }],
  maxTokens: 4096,
});
```

### Servers and namespacing

One plugin fronts any number of named MCP servers. `MCPServerConfig` is a
union — `transport: "stdio"` (`command`, `args?`, `env?`, `cwd?`) or
`transport: "http"` (`url` — Streamable HTTP with automatic SSE
fallback). Tools are exposed as `<server>.<tool>` so identically named
tools on different servers never collide; `callTool("<server>.<tool>",
args)` routes to the right client.

```ts
const plugin = createMCPPlugin({
  servers: [
    {
      name: "github",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
    },
    { name: "docs", transport: "http", url: "https://mcp.example.com/" },
  ],
});

const tools = await plugin.tools.listTools();
// → [{ name: "github.create-comment", ... }, { name: "docs.search", ... }]
```

### Lifecycle and errors

Connections are **lazy** — `createMCPPlugin` spawns nothing; each server
connects on the first `listTools()`/`callTool()` that needs it, so a
registered-but-unused plugin costs no processes. `dispose()` closes all
clients (best-effort, safe to call repeatedly); a later tool call
re-connects. `MCPClientPool` — the underlying pool — is exported for
direct use outside the plugin shape.

Failures throw `MCPPluginError` with a `code`:

| Code               | Meaning                                                     |
| ------------------ | ----------------------------------------------------------- |
| `CONNECT_FAILED`   | `Client.connect()` threw — server not found or refused      |
| `TOOL_NOT_FOUND`   | Tool name doesn't match `<server>.<tool>` or unknown server |
| `TOOL_CALL_FAILED` | The MCP server returned `isError: true` or threw            |
| `TRANSPORT_ERROR`  | Transport-level failure — process exited, HTTP 5xx          |

The caller (e.g. `AgentStep`) decides whether a failure retries or fails
the step — the plugin never swallows errors silently.

> **Security:** For HTTP transport, prefer HTTPS URLs to prevent cleartext
> credential exposure. The `http://` transport should only be used for
> local development (e.g. `http://localhost:PORT`).

## When to use MCP vs CLI

- **CLI + skill** — primary agent integration. Every command has
  `--format json`. Agents run `sverka run --entry ci --format json` and get
  structured results. No MCP setup needed.
- **MCP server** — when your agent client supports MCP natively (Claude
  Desktop, Copilot) and you want tool-level integration without shell
  access.
- **MCP client** — when your workflow's agent steps need external tools
  (GitHub, Slack, databases) exposed via MCP.

## Implementation

- `sverka mcp-server` — implemented in the `sverka` package (Spec 28)
- `@sverka/plugin-mcp` — implemented (Spec 23), supports stdio and HTTP
  transports with SSE fallback
- `AgentStep` — implemented in `@sverka/workflow` (Spec 27), with stub
  driver for testing. Real agent drivers (`@sverka/agent-openai`,
  `@sverka/agent-anthropic`) are follow-up packages.
