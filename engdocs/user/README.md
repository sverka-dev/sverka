# Sverka — User Documentation

User-facing docs for Sverka. These cover the public API, CLI, checks,
compilers, findings, and policy.

## Getting started

- [Install](./getting-started/install.md) — prerequisites, `bun install`, `sverka init`
- [First plan](./getting-started/first-plan.md) — define a workflow, plan, execute

## Workflow API

- [Overview](./workflow-api/overview.md) — `pipeline`, `run`, `parallel`, `when`, `matrix`, `task`, `defineWorkflow`

## CLI

- [Overview](./cli/overview.md) — all 7 commands, global flags, exit codes

## Checks

- [Built-in checks](./checks/builtin.md) — 6 check IDs, resolver behavior, SARIF extraction

## Compilation targets

- [GitHub Actions](./compilers/github.md) — `compileGithubWorkflow`
- [GitLab CI](./compilers/gitlab.md) — `compileGitlabCi`

## Findings

- [Normalization](./findings/normalization.md) — SARIF normalization, fingerprints, baselines, `filterOnlyNew`

## Policy

- [Evaluation](./policy/evaluation.md) — `evaluatePolicy`, `DEFAULT_POLICY`, `createPolicy`, verdicts
