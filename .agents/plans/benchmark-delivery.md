# Sverka Delivery Megaplan

> **Goal:** Deliver the committed Sverka functionality to a state where the
> two-agent benchmark (raw shell vs Sverka CLI+skill) can run, measure, and
> produce a comparison dashboard.

> **PR #142 (merged):** https://github.com/sverka-dev/sverka/pull/142 —
> website repositioned, docs accuracy fixed, 47 review threads resolved.

## Current state (post-merge)

### Working
- Construct API (`@sverka/workflow` — Project, Pipeline, ShellStep, Entry)
- Native engine (createEngine, engine.run, engine.query)
- CLI: validate, plan, graph, run, discover, check, policy, doctor, init, mcp-server
- `sverka compile` (github/gitlab — works but NOT registered in main.ts; synth stub is registered)
- MCP server (5 tools over stdio)
- Compiler library (github, gitlab, temporal, dagger, inngest, drone)
- Snapshot/suspend (resume throws RESUME_NOT_IMPLEMENTED)
- Docs website (https://sverka.dev)

### Blocking the benchmark
1. `sverka compile` not registered in CLI main.ts (synth stub is registered instead)
2. Packages at version 0.0.0, root private — can't npm install
3. No benchmark harness/arena exists
4. No comparison dashboard
5. AgentStep has stub driver only (not required for CLI benchmark, but needed for full demo)

## Delivery phases

### Phase 1: CLI Fixes (small, unblocks everything)
**Goal:** Make `sverka compile` work from CLI, fix quick wins.

| Task | What | Effort |
|------|------|--------|
| 1.1 | Register `compile` command in main.ts (replace or coexist with synth stub) | Trivial |
| 1.2 | Fix `sverka synth` to delegate to `compile` or mark as alias | Trivial |
| 1.3 | Run full test suite + build to verify no regressions | Small |

**Branch:** `fix/cli-compile-registration`
**Agent:** builder
**Formula step:** implement

### Phase 2: Package Publishing (medium, unblocks external agents)
**Goal:** Publish @sverka/cli, @sverka/sdk, @sverka/workflow, @sverka/runtime, @sverka/compiler to npm.

| Task | What | Effort |
|------|------|--------|
| 2.1 | Bump all package versions from 0.0.0 to 0.1.0 | Trivial |
| 2.2 | Set up npm publish CI (OIDC trusted publishing or automation token) | Medium |
| 2.3 | Build all packages, verify dist outputs are correct | Small |
| 2.4 | Dry-run publish (npm publish --dry-run) to verify package contents | Small |
| 2.5 | Publish to npm | Small (after CI setup) |

**Branch:** `feat/package-publishing`
**Agent:** builder
**Formula step:** implement
**Depends on:** Phase 1

### Phase 3: Benchmark Arena (medium, the core deliverable)
**Goal:** Build a two-agent benchmark harness that measures CLI delegation vs raw shell.

| Task | What | Effort |
|------|------|--------|
| 3.1 | Create `packages/benchmark/` package scaffold | Small |
| 3.2 | Define task scenarios (simple → complex, 5-10 tasks) | Medium |
| 3.3 | Build arena runner: spawns two agents, gives same task, collects metrics | Medium |
| 3.4 | Metrics collector: input/output tokens, tool-call count, execution time, success/fail | Medium |
| 3.5 | Task definitions: YAML workflow authoring, CI compilation, validation, multi-step pipeline | Medium |
| 3.6 | Run initial benchmark, collect baseline data | Small |
| 3.7 | Write benchmark docs (engdocs/user/agent-integration/benchmark.md) | Small |

**Branch:** `feat/benchmark-arena`
**Agent:** builder (mayor decomposes into sub-tasks)
**Formula step:** implement
**Depends on:** Phase 1 (compile must work), Phase 2 (packages must be installable for external agent)

### Phase 4: Comparison Dashboard (medium)
**Goal:** Web dashboard showing left/right comparison of both agents.

| Task | What | Effort |
|------|------|--------|
| 4.1 | Create `packages/benchmark-dashboard/` (Astro or simple HTML) | Small |
| 4.2 | Load benchmark results JSON, render comparison table + charts | Medium |
| 4.3 | Left pane: raw shell agent metrics; Right pane: Sverka CLI agent metrics | Medium |
| 4.4 | Deploy to sverka.dev/benchmark or standalone | Small |

**Branch:** `feat/benchmark-dashboard`
**Agent:** builder
**Formula step:** implement
**Depends on:** Phase 3

### Phase 5: Skill + Docs Finalization (small)
**Goal:** Ensure the Sverka skill and docs are ready for external agents.

| Task | What | Effort |
|------|------|--------|
| 5.1 | Update skill-cli.md with benchmark results (once available) | Small |
| 5.2 | Publish Sverka skill to skills registry | Small |
| 5.3 | Update website with benchmark page | Small |
| 5.4 | Write blog post / announcement | Small |

**Branch:** `docs/benchmark-results`
**Agent:** builder
**Formula step:** implement
**Depends on:** Phase 4

## Dependency graph

```
Phase 1 (CLI fixes)
  ├──► Phase 2 (Publishing)
  │      └──► Phase 3 (Benchmark arena)
  │             └──► Phase 4 (Dashboard)
  │                    └──► Phase 5 (Docs)
  └──► Phase 3 (can start task definitions in parallel with Phase 2)
```

## Gas City orchestration

- **Mayor** decomposes into beads, dispatches to builder/reviewer, finalizes PRs
- **Architect** produces implementation plans for each phase
- **Builder** implements via TDD
- **Reviewer** gates quality

Formula: `sverka-delivery` (new, extends sverka-wave pattern)
- One formula invocation per phase
- Mayor dispatches each phase as a separate wave
- Phases 1+2 can be sequential; Phase 3 can start task definitions while Phase 2 publishes

## Success criteria

1. `sverka compile --target github` works from CLI (no synth stub error)
2. `npm install @sverka/cli` succeeds and `npx sverka --help` works
3. Benchmark arena runs two agents on the same task and collects metrics
4. Dashboard shows comparison with token counts, tool calls, execution time
5. Website has a /benchmark page with live or static results

## Non-goals (for this delivery)

- Real AgentDriver implementation (Phase 6, deferred)
- Resume implementation (RESUME_NOT_IMPLEMENTED — separate wave)
- Builder API ($, shell tagged templates — separate wave)
- All compiler targets fully native (temporal/dagger/inngest/drone remain library-only)
