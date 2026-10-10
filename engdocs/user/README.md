# Sverka — User Documentation

Sverka is a framework for running local checks. Define checks in TypeScript,
run them locally, get structured findings. Compile to CI when you need to.

## Concepts

- [Why Sverka](./concepts/README.md) — what it solves, how it fits, design principles
- [Use cases](./use-cases/README.md) — local checks, CI compilation, agent orchestration, SARIF tooling

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

## Remote hub

- [Remote run hub](./hub/api.md) — self-hosted shared cache + run history, tokens, `/v1/` API, dashboard

## Workflows

- [Overview](./workflows/overview.md) — Construct API authoring surface

## Agent integration

- [Skill + CLI](./agent-integration/skill-cli.md) — AI agent integration via skill and CLI
- [MCP server](./agent-integration/mcp.md) — Sverka as an MCP server and MCP plugin client

## Compiling to CI

- [GitHub Actions](./compiling/github.md) — compile to GitHub Actions YAML
- [GitLab CI](./compiling/gitlab.md) — compile to GitLab CI YAML
- [Agentic workflows for GitLab](./gitlab/agentic.md) — gh-aw-style agent jobs, comment/issue triggers, safe-outputs
- [GitLab webhook setup](./gitlab/webhook-setup.md) — webhook → pipeline-trigger contract, schedules, apply token

## Hosted execution

- [Bootstrap job](./execution/hosted-bootstrap.md) — run the whole pipeline inside one CI job with `sverka run`

## Reference

- [Built-in checks](./reference/checks.md) — check IDs, resolver behavior, SARIF extraction
- [Findings normalization](./reference/findings.md) — SARIF normalization, fingerprints, baselines
- [Policy enforcement](./reference/policy.md) — rules, severities, enforcement
- [Run audit](./reference/audit.md) _(planned)_ — per-step timings, AI cost estimation
- [Graph visualization](./reference/graph.md) _(planned)_ — Mermaid flowchart output
- [Markdown authoring](./reference/markdown-authoring.md) — `.sverka.md` files
- [Roadmap](./reference/roadmap.md) — planned features and future targets
