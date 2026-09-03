# Sverka — User Documentation

Sverka is a portable workflow runtime. Define workflows in TypeScript,
run locally, compile anywhere. No external infrastructure required.

## Getting started

- [Install](./getting-started/install.md) — prerequisites, `bun install`, `sverka init`
- [First workflow](./getting-started/first-plan.md) — define, plan, execute, compile

## Workflows

- [Overview](./workflows/overview.md) — Construct API authoring surface

## Running

- [CLI](./running/cli.md) — all commands, global flags, exit codes
- [Saga compensations](./running/saga.md) — automatic rollback of succeeded steps on failure
- [Suspend and resume](./running/suspend-resume.md) — pause runs for external input, resume with data
- [Run queries](./running/run-queries.md) — read-only snapshot of run state
- [Snapshot storage](./running/storage.md) — persistent storage for suspend/resume snapshots

## Agent integration

- [Skill + CLI](./agent-integration/skill-cli.md) — AI agent integration via skill and CLI
- [MCP server](./agent-integration/mcp.md) — Sverka as an MCP server and MCP plugin client

## Compiling

- [GitHub Actions](./compiling/github.md) — compile to GitHub Actions YAML
- [GitLab CI](./compiling/gitlab.md) — compile to GitLab CI YAML
- [Temporal](./compiling/temporal.md) — compile to Temporal workflow + activity stubs
- [Dagger](./compiling/dagger.md) — compile to Dagger module
- [Inngest](./compiling/inngest.md) — compile to Inngest step function
- [Drone / Gitness](./compiling/drone.md) — compile to `.drone.yml` pipeline

## Reference

- [Built-in checks](./reference/checks.md) — check IDs, resolver behavior, SARIF extraction
- [Findings normalization](./reference/findings.md) — SARIF normalization, fingerprints, baselines
- [Policy enforcement](./reference/policy.md) — rules, severities, enforcement
- [Run audit](./reference/audit.md) *(planned)* — per-step timings, AI cost estimation
- [Graph visualization](./reference/graph.md) *(planned)* — Mermaid flowchart output
- [Markdown authoring](./reference/markdown-authoring.md) *(planned)* — `.sverka.md` files
- [Roadmap](./reference/roadmap.md) — planned features and future targets
