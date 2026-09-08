# Sverka Delivery: Implement

You are the builder for a Sverka delivery phase. Your job is to implement the
code from the phase plan, following TDD strictly.

## Inputs

- The megaplan is at `.agents/plans/benchmark-delivery.md`.
- The phase plan is at
  `engdocs/architecture/delivery-phase-{{phase_num}}-{{phase_name}}-plan.md`.
- The architecture spec is `specs/architecture-spec.md`.
- Relevant specs in `specs/NN-*/`.

## What to do

1. Read the phase plan.
2. Read the megaplan section for this phase to understand the goal.
3. Read any relevant specs.
4. Write failing tests first (TDD) — one test per plan item.
5. Implement until all tests pass.
6. Run all gates: `bun run test`, `bun run typecheck`, `bun run lint`,
   `bun run build`. All must be green (0 errors, 0 lint errors).
7. No `any` types — use `unknown` and narrow.
8. Public API exported from `src/index.ts`.
9. Custom error classes per package with `override` on `cause`.

## Phase-specific notes

### Phase 1 (CLI fixes)
- Register `compile` command in `packages/cli/src/main.ts`
- Make `synth` delegate to `compile` or become an alias
- Verify `sverka compile --target github` produces YAML
- Verify `sverka compile --target gitlab` produces YAML

### Phase 2 (Publishing)
- Bump all packages from 0.0.0 to 0.1.0
- Set up OIDC trusted publishing in CI (see npm-publish skill)
- Verify `bun run build` produces correct dist outputs
- Run `npm publish --dry-run` to verify package contents

### Phase 3 (Benchmark arena)
- Create `packages/benchmark/` with:
  - `src/arena.ts` — spawns two agents, gives same task, collects metrics
  - `src/tasks/` — task scenario definitions (5-10 tasks of varying complexity)
  - `src/metrics.ts` — metrics collector (tokens, tool calls, time, success)
  - `src/runner.ts` — orchestrates a single benchmark run
  - `src/reporter.ts` — outputs results as JSON
- Task scenarios should cover:
  1. Validate a workflow config
  2. Compile a workflow to GitHub Actions YAML
  3. Run a multi-step pipeline locally
  4. Discover checks for a project
  5. Author a CI pipeline from scratch
- The arena must be able to run with:
  - Agent A: raw shell + file editing (no Sverka)
  - Agent B: Sverka CLI + skill installed
- Metrics: input_tokens, output_tokens, tool_calls, execution_time_ms, success

### Phase 4 (Dashboard)
- Create `packages/benchmark-dashboard/` with:
  - Loads benchmark results JSON
  - Renders comparison table + charts
  - Left pane: raw shell agent; Right pane: Sverka CLI agent
  - Shows delta/improvement column
- Can be Astro or static HTML + JS

### Phase 5 (Docs)
- Update `engdocs/user/agent-integration/benchmark.md` with results
- Add benchmark page to website
- Update skill-cli.md with measured (not estimated) token numbers

## Commit hygiene

Stage ONLY the phase's package files + specs + plans + bun.lock.
Do NOT commit (conservative profile). Do NOT stage:
`city.toml`, `agents/`, `.devin/`, `.gc/`, `.beads/`, `formulas/`.

## When done

Report back to the mayor via mail. Close your bead with a concise reason
including test counts and gate status.
