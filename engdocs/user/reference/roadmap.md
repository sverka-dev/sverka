# Roadmap

Sverka is pre-alpha. This page tracks what exists, what is planned, and
what is deferred.

## Implemented

- **Construct API** — `Project`, `Pipeline`, `ShellStep`, `Entry` in
  `@sverka/workflow`
- **Definition Graph** — provider-neutral IR, synthesis, validation
- **Native engine** — topological scheduling, parallel steps, host and
  Docker drivers
- **CLI** — `init`, `validate`, `plan`, `graph`, `run`, `compile`,
  `discover`, `check`, `policy`, `doctor`, `mcp-server`
- **Compilers** — GitHub Actions, GitLab CI, Temporal, Dagger, Inngest,
  Drone (code generation targets)
- **MCP server** — `sverka mcp-server` exposes 5 tools over stdio
- **MCP plugin** — `@sverka/plugin-mcp` loads external MCP servers as
  Sverka plugins
- **AgentStep** — `AgentStep` in cdk, `AgentDriver` interface, stub driver
- **Suspend/resume** — snapshot-based pause and resume (Spec 29)
- **Saga compensations** — automatic rollback on failure (Spec 30)
- **CacheStore** — step-level caching (Spec 19)
- **RetryPolicy** — step-level retry (Spec 20)
- **RunEvent** — structured event protocol (Spec 21)
- **Action pinning** — GHA SHA pinning (Spec 22)
- **Checks** — built-in check IDs, SARIF extraction
- **Findings** — SARIF normalization, fingerprints, baselines
- **Policy** — rules, severities, enforcement

## Planned

- **SDK builder API** — `sh`, `agent`, `suspend` tagged templates
  (token-efficient authoring surface, Spec 03)
- **Agent drivers** — `@sverka/agent-openai`, `@sverka/agent-anthropic`
  (real LLM drivers for `AgentStep`)
- **Native CI lowering** — one-job-per-step for GitHub Actions and GitLab
  CI (currently thin-wrapper mode)
- **Markdown authoring** — `.sverka.md` files with YAML frontmatter
- **Run audit** — `sverka audit`, per-step timings, AI cost estimation
- **Graph visualization** — `sverka graph --format mermaid`
- **HTTP/SSE MCP transport** — MCP server over HTTP (currently stdio only)
- **Streaming agent output** — token-by-token agent step output
- **Multi-turn agent steps** — agent conversations within a step
- **Benchmark harness** — token/call/time comparison: agent with Sverka
  vs agent without, across workflow complexity levels

## Deferred

- **Decorator API** — `@pipeline`, `@step`, `@entry` decorators (built
  artifact exists, source not shipped)
- **Schedule trigger** — cron-based triggers (Spec F-05)
- **Matrix builds** — matrix strategy (Spec F-15)
- **Reusable workflows** — workflow composition (Spec F-31)
