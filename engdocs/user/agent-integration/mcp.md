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

| Tool | Input | Output |
|------|-------|--------|
| `sverka.validate` | `{ root?: string }` | `{ valid: boolean, errors: string[] }` |
| `sverka.plan` | `{ root?: string, entryId?: string }` | `{ planId: string, steps: number }` |
| `sverka.graph` | `{ root?: string }` | `{ pipelines: string[], steps: number, edges: number }` |
| `sverka.run` | `{ root?: string, entryId?: string, executor?: "host"\|"docker" }` | `{ status: "success"\|"failure"\|"cancelled", durationMs: number }` |
| `sverka.synth` | `{ root?: string, target: "github"\|"gitlab" }` | `{ artifacts: { path: string }[] }` |

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

The `@sverka/plugin-mcp` package lets workflows call external MCP servers.
This is used by `AgentStep` — an AI agent step can be given tools from any
MCP server.

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
      env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN! }, // Never hardcode tokens — use secret management
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

Tool names are namespaced `<server>.<tool>` to avoid collisions across
servers. Both stdio and HTTP transports are supported.

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

- `sverka mcp-server` — implemented in `@sverka/cli` (Spec 28)
- `@sverka/plugin-mcp` — implemented (Spec 23), supports stdio and HTTP
  transports with SSE fallback
- `AgentStep` — implemented in `@sverka/workflow` (Spec 27), with stub
  driver for testing. Real agent drivers (`@sverka/agent-openai`,
  `@sverka/agent-anthropic`) are follow-up packages.
