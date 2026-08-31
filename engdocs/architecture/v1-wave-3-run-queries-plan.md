# v1 Wave 3 — Run Queries Implementation Plan

**Bead:** sv-wthn.3.3
**Spec:** specs/32-run-queries/spec.md
**ADR:** ADR-015
**Depends on:** sv-wthn.3.1 (suspend/resume — `RunStatus` `"suspended"`, step `suspended` state). If suspend/resume is not yet implemented when the builder starts, implement `query` against the current `StepState` union (without `"suspended"`); the type reference tracks the engine automatically.
**Package:** `@sverka/runtime` (engine-native) — no new package, no new deps.

## Scope

One new `Engine` method (`query`) + one new exported type (`RunState`) +
a `currentRun` reference on `NativeEngine`. ~30 impl lines + ~120 test
lines. No SDK/CDK/compiler changes (query is an engine-level concern).

## Files

- `packages/runtime/src/engine-native/types.ts` — add `RunState`; add
  `query` to `Engine`.
- `packages/runtime/src/engine-native/engine.ts` — add `currentRun`
  field; set on `run-started`; clear on `run-completed`; implement
  `query()`.
- `packages/runtime/src/engine-native/index.ts` — re-export `RunState`.
- `packages/runtime/src/engine-native/__tests__/query.test.ts` — new.
- `packages/compiler/src/plugin/capabilities.ts` (or the capability
  manifest for `run.query`) — add `run.query`: native `native`, GHA
  `emulated`, GitLab `emulated`. (Only if a capability manifest entry is
  the established pattern; check how `suspend.resume` / `policy.compensation`
  were registered and mirror it. If no manifest edit is needed, skip.)

## TDD steps

1. **Write `query.test.ts` test #1:** `query()` before any run returns
   `undefined`. Run → fail (no `query` method). Add the `query` stub to
   `Engine`/`NativeEngine` returning `undefined`. Pass.

2. **Add `RunState` type** to `types.ts`; re-export from `index.ts`. Add a
   type-level test (#10): assign a `RunState`-shaped object. Pass.

3. **Test #2 + #6:** during an active 3-step linear run, pause iteration
   inside the `for await` loop after `step-succeeded` for step 1 (step 2
   running, step 3 pending) and call `engine.query()` → assert `status:
   "running"`, correct `runId`/`planId`/`startedAt`, step 1 `succeeded`
   with `durationMs`, step 2 `running`, step 3 `pending`. Implement
   `currentRun` set on `run-started` + the snapshot logic. Pass.

   *How to pause mid-run:* use a plan where step 2 has a `sleep` in its
   command (or a driver mock that resolves on a deferred) so the test can
   `await` a tick between events and call `query()` while step 2 is
   running. The existing test fixtures use mock drivers — add a deferred
   resolve to control timing.

4. **Test #3:** `query(activeRunId)` returns the same state as #2. Pass.

5. **Test #4:** `query("unknown-id")` during the active run → `undefined`.
   Pass (runId mismatch guard).

6. **Test #5:** after `run-completed` (`success`), `query()` → `undefined`.
   Implement `currentRun` clear on `run-completed` (after emitting). Pass.

7. **Test #7:** query inside the `for await` loop on the iteration that
   delivers `run-completed` (before the loop body returns) → terminal
   `RunStatus` (e.g. `"success"`), because `currentRun` is cleared *after*
   the event is emitted. Pass. (If the engine clears before yielding, fix
   the ordering: emit `run-completed`, then clear `currentRun` after the
   yield resumes — or capture the terminal status on `currentRun` before
   clearing so a racing query sees it. Simplest: set
   `currentRun.status = terminalStatus` before emitting `run-completed`,
   clear `currentRun` after the generator resumes from the yield.)

8. **Test #8:** a failed step appears `state: "failed"` with `durationMs`.
   Pass.

9. **Test #9:** a skipped step appears `state: "skipped"`, no `durationMs`.
   Pass.

10. **Test #11:** `run.query` capability — native `native`, GHA `emulated`,
    GitLab `emulated`. Mirror the capability registration used by
    `suspend.resume` (Spec 29) / `policy.compensation` (Spec 30). Pass.

11. **Test #12:** grep the impl for `any` → none. `RunState` uses
    `StepState` by reference; `query` returns `RunState | undefined`. Pass.

## Gates

- `bun run test` for `@sverka/runtime` (engine-native) — all existing
  tests + new query tests pass.
- `bun run typecheck` — 0 new errors (the package is clean; verify against
  the main-branch baseline error count if pre-existing errors exist).
- `bun run lint` — 0 errors.
- `bun run build` — `@sverka/runtime` emits.
- No `any`. `RunState` and `query` use existing types by reference.

## Commit hygiene (for finalize)

Stage ONLY:
- `packages/runtime/src/engine-native/types.ts`
- `packages/runtime/src/engine-native/engine.ts`
- `packages/runtime/src/engine-native/index.ts`
- `packages/runtime/src/engine-native/__tests__/query.test.ts`
- the capability manifest file (if edited)
- `specs/32-run-queries/spec.md`
- `engdocs/architecture/v1-wave-3-run-queries-plan.md`
- `engdocs/adr/ADR-015-run-queries-signals-deferred.md`

EXCLUDE: `city.toml`, `agents/`, `.devin/`, `.gc/`, `.beads/`, `.evidence/`,
`.opencode/`, `formulas/`, and any concurrent uncommitted changes from
other Wave 3 features (suspend/resume, saga, storage) — those belong to
their own beads/commits.

## Notes for the builder

- The engine is **single-active-run** (`activeRun` guard in `run()`).
  `query` reflects that one run. Do not add multi-run tracking.
- `StepState` is imported from `scheduler.ts` (already exported). Do not
  duplicate the union in `RunState` — reference it by type so it tracks
  the engine automatically (including `"suspended"` once Spec 29 lands).
- `query` is **synchronous** (state is in memory). Do not make it async.
- `durationMs` per step: the engine records it in `step-succeeded`/
  `step-failed` events. To surface it in `RunState`, track a
  `Map<stepId, number>` (step result duration) on `RunContext`, populated
  when a step succeeds/fails. Check whether `RunContext` already has this
  (the `step-succeeded` event carries `durationMs` — the value is in
  scope at emit time); if not, add a small `stepDurations` map.
- If suspend/resume (Spec 29) is NOT yet implemented in source when you
  start, the `Engine` interface will not have `resume` and `RunStatus`
  will not have `"suspended"`. Implement `query` against the current
  interface; `RunState.status` is `"running" | RunStatus` (whatever
  `RunStatus` is at that point). Do NOT implement suspend/resume as part
  of this bead.
