# v1 Wave 1 Plan — CacheStore

**Spec:** 19-cachestore
**Package:** `@sverka/runtime` (engine-native sub-module)
**Date:** 2026-08-31
**Base branch:** `v1-w1-core-ci` (refactor tip, = main after PRs #116–#120)

## Scope

Add content-addressed step caching to the canonical native engine. Reuses
the existing `CacheSpec` model unchanged. New `CacheStore` interface +
`FileCacheStore` impl + engine wiring + `step-cache-hit` event + context-ref
key resolution.

## Files

| File | Action |
|---|---|
| `packages/runtime/src/engine-native/cache-store.ts` | **New** — `CacheStore` interface, request/result types, `createFileCacheStore`. |
| `packages/runtime/src/engine-native/types.ts` | **Edit** — add `cache?: CacheStore` to `EngineConfig` and `RunRequest`; add `step-cache-hit` to `RunEvent`. |
| `packages/runtime/src/engine-native/engine.ts` | **Edit** — in `runStep`: pull before execute (policy pull/pull-push), push after success (policy push/pull-push); emit `step-cache-hit`; resolve context refs in key. |
| `packages/runtime/src/engine-native/index.ts` | **Edit** — export `CacheStore`, `FileCacheStoreConfig`, `createFileCacheStore`, `CacheRestoreRequest`, `CacheRestoreResult`, `CacheStoreRequest`. |
| `packages/runtime/src/engine-native/__tests__/cache-store.test.ts` | **New** — FileCacheStore unit tests (items 1–3, 9–10). |
| `packages/runtime/src/engine-native/__tests__/engine-cache.test.ts` | **New** — engine integration tests (items 4–8). |
| `packages/runtime/src/engine-native/__tests__/public-api.test.ts` | **Edit** — assert new exports (item 11). |

## TDD steps

1. Write `cache-store.test.ts` items 1–3 (round-trip, miss, restoreKeys
   fallback). Implement `createFileCacheStore` until green.
2. Add `step-cache-hit` to `RunEvent` + `cache?` to `EngineConfig`/`RunRequest`
   in `types.ts`.
3. Write `engine-cache.test.ts` item 4 (hit skips execution, emits
   `step-cache-hit`, ends succeeded). Wire `tryCacheHit` into `runStep`.
4. Write item 5 (miss → run → store). Wire `storeCacheResult` after success.
5. Write items 6 (policy pull/push gating). Implement policy checks.
6. Write item 7 (context-ref key resolution). Add `resolveCacheKey` helper
   reusing `resolveContextRef`.
7. Write item 8 (step-ref in key rejected). Add validation in
   `core/validate.ts` (`CACHE_KEY_STEP_REF`).
8. Write items 9–10 (restore/store throw → warn diagnostic, non-fatal).
   Wrap cache calls in try/catch emitting `diagnostic` (warn).
9. Update `public-api.test.ts` (item 11) + `index.ts` exports.
10. Add `cache`/`cache.policy`/`cache.fallbackKeys` (`lowered`) to the
    GitHub target manifest (`packages/compiler/src/github/capabilities.ts`).
    GitLab already declares them (`native`) — no change.
11. Run gates: `bun run test`, `bun run typecheck`, `bun run lint`,
    `bun run build`. All green.

## Commit hygiene

Stage ONLY `packages/runtime/src/engine-native/**` (cache-store.ts, types.ts,
engine.ts, index.ts, tests) + `packages/workflow/src/core/validate.ts` (if
touched) + `packages/compiler/src/github/capabilities.ts` +
`specs/19-cachestore/spec.md` + this plan + `bun.lock` (if deps change —
none expected). EXCLUDE city.toml, agents/, .devin/, .gc/, .beads/,
formulas/, engdocs/adr/.
