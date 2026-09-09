# Sverka — User Documentation

Sverka is a framework for running local checks. Define checks in TypeScript,
run them locally, get structured findings. Compile to CI when you need to.

## Concepts

- [Why Sverka](./concepts/) — what it solves, how it fits, design principles
- [Use cases](./use-cases/) — local checks, CI compilation, agent orchestration, SARIF tooling

## Getting started

- [Install](./getting-started/install.md) — prerequisites, `bun install`, `sverka init`
- [First workflow](./getting-started/first-plan.md) — define, run, view, compile

## Running checks

- [CLI](./running/cli.md) — all commands, global flags, exit codes
- [Saga compensations](./running/saga.md) — automatic rollback of succeeded steps on failure
- [Suspend and resume](./running/suspend-resume.md) — pause runs for external input, resume with data
- [Run queries](./running/run-queries.md) — read-only snapshot of run state
- [Snapshot storage](./running/storage.md) — persistent storage for suspend/resume snapshots

## Findings & SARIF

- [SARIF pipeline](./findings/sarif-pipeline.md) — serialize findings, view in TUI, generate HTML, web dashboard

## Workflows

- [Overview](./workflows/overview.md) — Construct API authoring surface

## Agent integration

- [Skill + CLI](./agent-integration/skill-cli.md) — AI agent integration via skill and CLI
- [MCP server](./agent-integration/mcp.md) — Sverka as an MCP server and MCP plugin client

## Compiling to CI

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
