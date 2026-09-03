# Sverka — User Documentation

User-facing docs for Sverka v1. These cover the authoring surfaces,
native runtime, compilation targets, CLI, checks, findings, and policy.

## Getting started

- [Install](./getting-started/install.md) — prerequisites, `bun install`, `sverka init`
- [First plan](./getting-started/first-plan.md) — define a workflow, plan, execute, compile

## Workflow API

- [Overview](./workflow-api/overview.md) — Construct, SDK, and Decorator authoring surfaces

## Authoring surfaces

- [Markdown authoring](./authoring/markdown.md) *(planned)* — `.sverka.md` files with YAML frontmatter and step lists

## CLI

- [Overview](./cli/overview.md) — all 10 commands, global flags, exit codes

## Runtime

- [Saga compensations](./runtime/saga.md) — automatic rollback of succeeded steps on failure
- [Suspend and resume](./runtime/suspend-resume.md) — pause runs for external input, resume with data
- [Run queries](./runtime/run-queries.md) — read-only snapshot of run state
- [Snapshot storage](./runtime/storage.md) — persistent storage for suspend/resume snapshots

## Compilation targets

- [GitHub Actions](./compilers/github.md) — `@sverka/compiler`, native lowering
- [GitLab CI](./compilers/gitlab.md) — `@sverka/compiler`, native lowering
- [Temporal](./compilers/temporal.md) — `@sverka/compiler`, workflow + activity stubs
- [Dagger](./compilers/dagger.md) — `@sverka/compiler`, Dagger module with Container chaining
- [Inngest](./compilers/inngest.md) — `@sverka/compiler`, step function with `createFunction`
- [Drone / Gitness](./compilers/drone.md) — `@sverka/compiler`, `.drone.yml` pipeline

## Observability

- [Run reports and audit](./observability/audit.md) — `sverka audit`, per-step timings, AI cost estimation
- [Graph visualization](./observability/graph.md) — `sverka graph --format mermaid`, Mermaid flowchart output

## Checks

- [Built-in checks](./checks/builtin.md) — check IDs, resolver behavior, SARIF extraction

## Findings

- [Normalization](./findings/normalization.md) — SARIF normalization, fingerprints, baselines

## Policy

- [Policy enforcement](./policy/evaluation.md) — rules, severities, enforcement

## Feature matrix

- [All features](../../specs/features/overview.md) — F-01 to F-49: every GitHub Actions and GitLab CI capability mapped to Sverka's portable model, with provider matrices and lowering rules
