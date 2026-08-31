# v1 Wave 1 Plan — RunEvent Protocol

**Spec:** 21-run-events
**Package:** `@sverka/runtime` (engine-native sub-module)
**Date:** 2026-08-31
**Base branch:** `v1-w1-core-ci`

## Scope

Formalize the existing 10-event RunEvent protocol and add two Wave 1
variants (`step-cache-hit`, `step-retry`). The new variants are **added by
the CacheStore and RetryPolicy plans** — this plan only adds the protocol
tests and the export assertions. It is the smallest of the four.

## Dependency

This plan's new event variants are implemented inside the CacheStore
(spec 19) and RetryPolicy (spec 20) plans. Run this plan **after** both, to
add the cross-cutting protocol/ordering tests and verify the union is
complete and exported.

## Files

| File | Action |
|---|---|
| `packages/runtime/src/engine-native/types.ts` | **Edit** (via specs 19/20) — `step-cache-hit`, `step-retry` members. |
| `packages/runtime/src/engine-native/__tests__/run-events.test.ts` | **New** — protocol/ordering tests (items 1–6). |
| `packages/runtime/src/engine-native/__tests__/public-api.test.ts` | **Edit** — assert `RunEvent` (with new variants) + `RunStatus` exported (item 7). |

## TDD steps

1. Write `run-events.test.ts` item 1 (run-started first, run-completed last)
   against the existing engine.
2. Write item 2 (step-pending before other step events).
3. Write item 3 (cache hit → step-cache-hit then step-succeeded, no
   ready/started) — requires CacheStore plan done.
4. Write item 4 (retry → step-retry with attempt + nextAttemptMs before
   each rerun) — requires RetryPolicy plan done.
5. Write item 5 (setup failure → diagnostic error + run-completed failure,
   no throw).
6. Write item 7 (export assertions) in public-api.test.ts.
7. Write item 6 (existing engine tests still pass) — run the full
   engine-native suite.
8. Run gates: `bun run test`, `bun run typecheck`, `bun run lint`,
    `bun run build`. All green.

## Commit hygiene

Stage ONLY `packages/runtime/src/engine-native/__tests__/run-events.test.ts`
+ `packages/runtime/src/engine-native/__tests__/public-api.test.ts` +
`specs/21-run-events/spec.md` + this plan. EXCLUDE city.toml, agents/,
.devin/, .gc/, .beads/, formulas/, engdocs/adr/.
