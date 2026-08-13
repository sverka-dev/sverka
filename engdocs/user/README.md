# Sverka — User Documentation

User-facing docs for Sverka v0. These cover the three authoring surfaces,
native targets, CLI, checks, findings, and policy.

## Getting started

- [Install](./getting-started/install.md) — prerequisites, `bun install`, `sverka init`
- [First plan](./getting-started/first-plan.md) — define a workflow, plan, execute, compile

## Workflow API

- [Overview](./workflow-api/overview.md) — Construct, SDK, and Decorator authoring surfaces

## CLI

- [Overview](./cli/overview.md) — all 10 commands, global flags, exit codes

## Compilation targets

- [GitHub Actions](./compilers/github.md) — `@sverka/github`, native lowering
- [GitLab CI](./compilers/gitlab.md) — `@sverka/gitlab`, native lowering

## Checks

- [Built-in checks](./checks/builtin.md) — check IDs, resolver behavior, SARIF extraction

## Findings

- [Normalization](./findings/normalization.md) — SARIF normalization, fingerprints, baselines

## Policy

- [Policy enforcement](./policy/overview.md) — rules, severities, enforcement
