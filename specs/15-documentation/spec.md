# Spec 15 — Documentation: User Docs

## Overview

Write the user-facing documentation for Sverka. Agentic docs (architecture,
ADRs, contributing) already exist in `engdocs/`; this wave fills the missing
`engdocs/user/` tree.

Documentation is markdown. No package, no TypeScript code, no auto-generation.

## Goals

1. User docs covering: getting started, workflow API, CLI reference, check
   providers, compilation targets, findings, and policy.
2. Every code example matches the actual public API exported from
   `@sverka/sdk` and the actual CLI commands.
3. Docs are readable as raw markdown (for agents) and renderable by the
   website (for humans).
4. All docs versioned alongside code in the repository.

## Non-goals

- Building a documentation package or TypeScript tooling. Docs are markdown.
- Auto-generating docs from TypeScript types or CLI definitions. Hand-written
  for v1 — simpler, less brittle, includes prose context.
- A doc-first validator, link checker module, or ADR linter. Process
  enforcement is handled by the Gas City workflow, not code.
- Plugin documentation. Wave 11 cut plugin descriptors — no plugins exist.
- API reference for internal modules. Only public `@sverka/sdk` surface.

## Pages

```
engdocs/user/
  README.md                      # index of user docs
  getting-started/
    install.md                   # prerequisites, bun install, sverka init
    first-plan.md                # defineWorkflow, pipeline, task, run, plan, execute
  workflow-api/
    overview.md                  # pipeline, run, parallel, when, matrix, task, defineWorkflow
  cli/
    overview.md                  # 7 commands + global flags + exit codes
  checks/
    builtin.md                   # 6 check IDs, resolver behavior, SARIF extraction
  compilers/
    github.md                    # compileGithubWorkflow usage
    gitlab.md                    # compileGitlabCi usage
  findings/
    normalization.md             # SARIF normalization, fingerprints, baselines, filterOnlyNew
  policy/
    evaluation.md                # evaluatePolicy, failOn rules, DEFAULT_POLICY, verdicts
```

## Content requirements

### getting-started/install.md
- Prerequisites: Node.js 24+, Bun
- `bun install`, `bunx sverka init` (creates `sverka.config.ts`)
- Link to first-plan

### getting-started/first-plan.md
- Complete working example using `defineWorkflow`, `pipeline`, `task`, `run`
  from `@sverka/sdk`
- `bunx sverka plan` to synthesize, `bunx sverka execute` to run
- Code example MUST match actual SDK exports (verified against
  `packages/sdk/src/index.ts`)

### workflow-api/overview.md
- `pipeline(...operations)` — sequential composition
- `run({ command, args })` — shell execution operation
- `parallel(...operations)` — concurrent composition
- `when(condition, operation)` — conditional execution
- `matrix(values, fn)` — matrix expansion
- `task(name, op)` — sugar for `op.named(name)`
- `defineWorkflow({ name, workflow })` — type-safe config helper
- All signatures match `packages/core/src/` and `packages/sdk/src/index.ts`

### cli/overview.md
- 7 commands: `init`, `inspect`, `plan`, `execute` (alias `run`), `validate`,
  `baseline` (subcommands: create, update, show, clear), `doctor`
- Global flags: `--config/-c`, `--root/-r`, `--format/-f`, `--quiet/-q`,
  `--verbose/-v`
- `execute`/`run` flags: `--executor` (host|docker), `--only-new`, `--baseline`
- Exit codes: 0 success, 1 policy fail, 2 usage error, 3 runtime error
- Verified against `packages/cli/src/main.ts`

### checks/builtin.md
- 6 built-in check IDs: `typecheck`, `lint`, `test`, `clippy`, `vet`,
  `fmt-check`
- Per-language resolution: Node (bun/npm/yarn/pnpm), Python, Rust, Go
- `createBuiltinResolver()` and `extractFindings()` from `@sverka/sdk`
- SARIF extraction from check outputs

### compilers/github.md
- `compileGithubWorkflow(plan, config?)` from `@sverka/compiler-github`
- Thin wrapper: single job runs `sverka execute .sverka/plan.json`
- Credential mapping via `envVar` → `${{ secrets.VAR }}`
- Trigger and permission name conversions (camelCase → kebab-case)

### compilers/gitlab.md
- `compileGitlabCi(plan, config?)` from `@sverka/compiler-gitlab`
- Thin wrapper: single job in `verify` stage
- GitLab CI variables auto-injected (no explicit env mapping needed)

### findings/normalization.md
- `normalizeSarif(sarif)` — SARIF 2.1.0 → `Finding[]`
- `computeFingerprint(finding)` — SHA-256 of checkId|rule|file|lines
- Baseline CRUD: `createBaseline`, `updateBaseline`, `loadBaseline`,
  `saveBaseline`
- `filterOnlyNew(findings, baseline)` — filter to new findings

### policy/evaluation.md
- `evaluatePolicy(findings, policy, baselineFingerprints?)` → `PolicyResult`
- `DEFAULT_POLICY` — fail on error severity
- `createPolicy({ failOn: [...] })` — custom rules
- `FailOnRule`: severity threshold, onlyNew, checkIds
- `Verdict`: pass | fail

## Updates to existing files

- `engdocs/README.md` — add "User docs" section linking to `user/README.md`
- `website/src/pages/docs.astro` — link user doc sections to GitHub paths

## Error handling

No error classes. Docs are markdown. Broken links are caught by the test
plan's link check.

## Test plan

1. **Link check**: every internal markdown link in `engdocs/user/**/*.md`
   resolves to an existing file. Run: `find engdocs/user -name '*.md' |
   xargs grep -oP '\]\(\K[^)]+' | sort -u` and verify each path exists.
2. **Code example accuracy**: every code example in user docs uses only
   exports that exist in `packages/sdk/src/index.ts` or the relevant
   package's `src/index.ts`. Verified by grep cross-reference.
3. **CLI accuracy**: every command and flag in `cli/overview.md` exists in
   `packages/cli/src/main.ts`.
4. **Completeness**: every runtime export from `@sverka/sdk` (functions, not
   type-only) is mentioned in at least one user doc page.
5. **No broken cross-references**: links between user docs pages resolve.
6. **Markdown renders**: no malformed markdown (unclosed code blocks, broken
   headings).
