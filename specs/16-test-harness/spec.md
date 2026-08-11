# Spec 16 — Harness Pack E2E Test

## Overview

Minimal spec to validate the decoupled sverka-gc-pack harness works end-to-end:
agents load, formulas dispatch, skills are discoverable, project-context is injected.

## Goals

- Verify `gc sling harness.mayor wave --formula` creates step beads
- Verify agents receive project-context.md via append_fragments
- Verify skills in pack/skills/ are discoverable by agents
- Verify the wave formula design→implement→review→finalize cycle works
- Verify every pack skill is invocable by agents (sverka-wave, sverka-review,
  sverka-drill, sverka-merge-stack)
- Verify every pack formula dispatches correctly (wave, address-review,
  bootstrap-sdd, merge-stack)
- Verify a wave must complete successfully (all gates green, reviewer
  approved) before the harness proceeds to the next wave

## Non-goals

- Building a real package
- Testing cross-project reuse

## Interfaces

The harness exposes these test interfaces:

- `HarnessDriver` — orchestrates the end-to-end test run:
  - `dispatch(formula: string): Promise<void>` — sling a formula to the mayor
  - `assertSkillInvocable(name: string): Promise<void>` — verify a skill loads.
    Lookup path: resolve `pack/skills/<name>/SKILL.md` relative to the pack
    root, parse frontmatter, confirm the skill body is non-empty and the
    declared `name` field matches the requested skill name. Throws if the file
    is missing, the frontmatter is invalid, or the name does not match.
  - `assertFormulaDispatches(name: string): Promise<void>` — verify a formula
    creates step beads
  - `waitForWaveComplete(timeoutMs: number): Promise<WaveResult>` — block until
    the wave passes review or fails, returning the final verdict
  - `dispatchSecondWave(formula: string): Promise<void>` — dispatch a second
    wave after the first completes; used by the two-wave transition test to
    verify dispatch timing and wave-state gating
- `WaveResult` — outcome of a completed wave:
  - `verdict: "pass" | "fail" | "cancelled"`
  - `steps: StepBead[]` — the design, implement, review, finalize beads
  - `gates: GateResult` — test, build, lint, typecheck outcomes
- `StepBead` — a single step in the wave cycle:
  - `name: "design" | "implement" | "review" | "finalize"` — the step name
  - `order: number` — 1-based position in the cycle (design=1, implement=2,
    review=3, finalize=4)
  - `state: "pending" | "in_progress" | "completed" | "skipped"` — current
    completion state
- `GateResult` — outcome of the four quality gates:
  - `test: "pass" | "fail" | "skipped"`
  - `build: "pass" | "fail" | "skipped"`
  - `lint: "pass" | "fail" | "skipped"`
  - `typecheck: "pass" | "fail" | "skipped"`

## Test plan

1. `gc sling harness.mayor wave --formula` dispatches without error
2. Step beads are created (design, implement, review, finalize) in the exact
   order design → implement → review → finalize, each reaching `completed`
   state
3. Agent prompts contain the complete project-context fragment injected by
   `append_fragments`. Assert the fragment includes the exact project name
   (`Sverka`), the full technology stack (`TypeScript`, `Bun`, `Nx`,
   `Vitest`, `tsdown`), and all command entries (`bun install`, `bun run
   build`, `bun run test`, `bun run lint`, `bun run typecheck`)
4. `skill sverka-wave` is invocable by agents
5. Every pack skill is invocable: `sverka-wave`, `sverka-review`,
   `sverka-drill`, `sverka-merge-stack`
6. Every pack formula dispatches and creates step beads: `wave`,
   `address-review`, `bootstrap-sdd`, `merge-stack`
7. Wave must complete successfully — all gates green (test, build, lint,
   typecheck) and reviewer approved — before the harness proceeds to the
   next wave. Verify with a two-wave scenario: dispatch a second wave and
   confirm it remains withheld (not started) while the first wave has
   failing gates or lacks reviewer approval; confirm the second wave starts
   only after the first wave reaches `verdict: "pass"` with all gates green
   and reviewer approval
8. Successful wave completion: the wave follows the exact design → implement
   → review → finalize order, all steps reach `completed`, all gates are
   green, and reviewer approval is recorded. Cleanup verifies no orphaned
   sessions or beads remain after a successful wave
9. Wave cancellation: a cancelled wave (`verdict: "cancelled"`) is tested
   independently. Verify cleanup runs correctly for cancellation — no
   orphaned sessions or beads remain — and that a cancelled wave does NOT
   satisfy the success-completion test (i.e. cancellation must not be
   accepted as a passing outcome for test item 8)
