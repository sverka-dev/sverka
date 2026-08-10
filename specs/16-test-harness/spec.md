# Spec 16 — Harness Pack E2E Test

## Overview

Minimal spec to validate the decoupled sverka-gc-pack harness works end-to-end:
agents load, formulas dispatch, skills are discoverable, project-context is injected.

## Goals

- Verify `gc sling harness.mayor wave --formula` creates step beads
- Verify agents receive project-context.md via append_fragments
- Verify skills in pack/skills/ are discoverable by agents
- Verify the wave formula design→implement→review→finalize cycle works

## Non-goals

- Building a real package
- Testing all formulas (address-review, bootstrap-sdd)
- Testing cross-project reuse

## Interfaces

None — this is a process test, not a code package.

## Test plan

1. `gc sling harness.mayor wave --formula` dispatches without error
2. Step beads are created (design, implement, review, finalize)
3. Agent prompts contain project-context content (Sverka, TypeScript, etc.)
4. `skill sverka-wave` is invocable by agents
5. Wave completes or is cancelled cleanly
