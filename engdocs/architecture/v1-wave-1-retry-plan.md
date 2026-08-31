# v1 Wave 1 Plan — RetryPolicy

**Spec:** 20-retry
**Packages:** `@sverka/workflow` (model: `BackoffSpec`), `@sverka/runtime` (engine-native: retry loop)
**Date:** 2026-08-31
**Base branch:** `v1-w1-core-ci`

## Scope

Add step-level retries with exponential backoff to the canonical native
engine. Extends `RetryPolicy` with optional `BackoffSpec`; adds
`executeStepWithRetry` wrapper + `step-retry` event.

## Files

| File | Action |
|---|---|
| `packages/workflow/src/cdk/model.ts` | **Edit** — add `BackoffSpec` interface; add `backoff?: BackoffSpec` to `RetryPolicy`. |
| `packages/workflow/src/cdk/index.ts` | **Edit** — export `BackoffSpec`. |
| `packages/workflow/src/core/graph.ts` | **Edit** — re-export `BackoffSpec`. |
| `packages/runtime/src/engine-native/retry.ts` | **New** — `executeStepWithRetry`: retry loop, `classifyRetryWhen`, backoff delay, cancellation, emits `step-retry`. |
| `packages/runtime/src/engine-native/types.ts` | **Edit** — add `step-retry` to `RunEvent`. |
| `packages/runtime/src/engine-native/engine.ts` | **Edit** — `runStep` calls `executeStepWithRetry` instead of `executeStep` directly. |
| `packages/runtime/src/engine-native/__tests__/retry.test.ts` | **New** — retry unit/integration tests (items 1–11). |
| `packages/workflow/src/cdk/__tests__/model.test.ts` (or existing) | **Edit** — assert `BackoffSpec` export (item 12). |
| `packages/compiler/src/github/capabilities.ts` | **Edit** — `policy.retry`: `unsupported` → `emulated`. |

## TDD steps

1. Add `BackoffSpec` to `RetryPolicy` in cdk/model.ts + export. Write item 12
   (export assertion) first.
2. Add `step-retry` to `RunEvent` in `types.ts`.
3. Write `retry.test.ts` item 1 (fail twice then succeed → succeeded, 2
   `step-retry` events). Implement `executeStepWithRetry` until green.
4. Write item 2 (always fail, max:1 → failed, 1 retry, 2 attempts).
5. Write items 3–4 (`when: ["timeout"]` gating). Implement
   `classifyRetryWhen` from `ShellResult`.
6. Write item 5 (`exitCodes` overrides `when`).
7. Write item 6 (backoff delays: 100, 200, cap 150). Implement backoff
   delay calc + `cancellableSleep` (reuse pattern from legacy
   `runtime/internal/scheduler-helpers.ts`).
8. Write item 7 (no backoff → immediate).
9. Write item 8 (cancel during sleep → cancelled, no further retries).
10. Write items 9–10 (max:0 → no retry; max:-1 → validation error). Add
    `INVALID_RETRY_POLICY` to `core/validate.ts`.
11. Write item 11 (whole-step rerun: both operations re-run on retry —
    verify driver call count).
12. Update github capabilities (`policy.retry` → `emulated`).
13. Run gates: `bun run test`, `bun run typecheck`, `bun run lint`,
    `bun run build`. All green.

## Reuse

- Backoff sleep-with-cancellation pattern: mirror `cancellableSleep` from
  the legacy `runtime/internal/scheduler-helpers.ts` (do NOT import it —
  re-implement the 5-line helper in engine-native to keep engine-native
  decoupled from the legacy scheduler).
- `ShellResult.timedOut` / `exitCode` already exist on the driver result.

## Commit hygiene

Stage ONLY `packages/workflow/src/cdk/**` (model.ts, index.ts) +
`packages/workflow/src/core/graph.ts` + `packages/runtime/src/engine-native/**`
(retry.ts, types.ts, engine.ts, tests) + `packages/workflow/src/core/validate.ts`
(if touched) + `packages/compiler/src/github/capabilities.ts` +
`specs/20-retry/spec.md` + this plan + `bun.lock` (if deps change — none
expected). EXCLUDE city.toml, agents/, .devin/, .gc/, .beads/, formulas/,
engdocs/adr/.
