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
  - `assertSkillInvocable(name: string): Promise<void>` — verify a skill loads
  - `assertFormulaDispatches(name: string): Promise<void>` — verify a formula
    creates step beads
  - `waitForWaveComplete(timeoutMs: number): Promise<WaveResult>` — block until
    the wave passes review or fails, returning the final verdict
- `WaveResult` — outcome of a completed wave:
  - `verdict: "pass" | "fail"`
  - `steps: StepBead[]` — the design, implement, review, finalize beads
  - `gates: GateResult` — test, build, lint, typecheck outcomes

## Test plan

1. `gc sling harness.mayor wave --formula` dispatches without error
2. Step beads are created (design, implement, review, finalize)
3. Agent prompts contain project-context content (Sverka, TypeScript, etc.)
4. `skill sverka-wave` is invocable by agents
5. Every pack skill is invocable: `sverka-wave`, `sverka-review`,
   `sverka-drill`, `sverka-merge-stack`
6. Every pack formula dispatches and creates step beads: `wave`,
   `address-review`, `bootstrap-sdd`, `merge-stack`
7. Wave must complete successfully — all gates green (test, build, lint,
   typecheck) and reviewer approved — before the harness proceeds
8. Wave completes or is cancelled cleanly (no orphaned sessions or beads)
