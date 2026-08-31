# Spec 19 — CacheStore

**Status:** Active
**Source:** specs/architecture-spec.md §22, §24, §25 (Cache row), §32 (deferred from v0 → M1)
**Package:** `@sverka/runtime` (engine-native sub-module)
**Capability:** `cache` / `cache.policy` / `cache.fallbackKeys` (existing manifest convention) — GitHub: `lowered` (via `actions/cache`); GitLab: `native` (already declared). The native engine implements cache directly (no engine capability manifest exists today).
**Related:** ADR-011, Spec 10 (engine-native), Spec 21 (RunEvent)

## Overview

Content-addressed step-result caching for the native engine. When a step
declares `cache: CacheSpec` and the engine is configured with a `CacheStore`,
a cache **hit** skips step execution and restores the cached paths into the
step workspace; a **miss** runs the step and stores the declared paths on
success. The engine emits a `step-cache-hit` run event.

The `CacheSpec` model (`@sverka/workflow` cdk/model.ts) is reused unchanged:
`{ paths, key, restoreKeys?, policy? }`. The native engine resolves context
references (`env.*`, `git.*`, `matrix.*`, `inputs.*`) in `key` and
`restoreKeys` before lookup; step-output refs are disallowed in cache keys
(chicken-egg — the step has not run yet).

## Goals

- `CacheStore` interface in engine-native: `restore()` + `store()`.
- `FileCacheStore`: filesystem-backed implementation (content-addressed by
  `sha256(key)`); stores paths under `<cacheDir>/<sha256>/` with a manifest.
- Wire cache into `NativeEngine.runStep`: pull before execute (policy
  `pull`/`pull-push`), push after success (policy `push`/`pull-push`).
- `step-cache-hit` RunEvent variant (Spec 21).
- Context-ref key resolution (env/git/matrix/inputs only).
- `cache` / `cache.policy` / `cache.fallbackKeys` added to the GitHub
  target manifest (`lowered`); GitLab already declares them (`native`).
- `cache?: CacheStore` on `EngineConfig` and `RunRequest` (request overrides
  config).

## Non-goals

- Distributed / shared cache backends (S3, GHA cache, etc.) — follow-up.
- Cache eviction, TTL, size limits, compression — follow-up.
- Step-output refs in cache keys — disallowed (validate rejects).
- Cache for the legacy `runtime/` scheduler — not extended (ADR-011).
- SDK `execute` path integration — follow-up (SDK migration bead).

## Interfaces

```ts
import type { CacheSpec } from "@sverka/workflow";

// --- Cache store (engine-native) ---

interface CacheRestoreRequest {
  readonly key: string;
  readonly restoreKeys: readonly string[];
  readonly paths: readonly string[];
  readonly targetDir: string; // step workspace root
}

interface CacheRestoreResult {
  readonly key: string; // the key that hit (primary or restoreKey)
}

interface CacheStoreRequest {
  readonly key: string;
  readonly paths: readonly string[]; // relative to sourceDir
  readonly sourceDir: string; // step workspace root
}

interface CacheStore {
  restore(req: CacheRestoreRequest): Promise<CacheRestoreResult | undefined>;
  store(req: CacheStoreRequest): Promise<void>;
}

// --- FileCacheStore ---

interface FileCacheStoreConfig {
  readonly cacheDir: string;
}

function createFileCacheStore(config: FileCacheStoreConfig): CacheStore;
```

`EngineConfig` and `RunRequest` gain `readonly cache?: CacheStore`.

## Data models

`CacheSpec` (existing, unchanged):
```ts
interface CacheSpec {
  readonly paths: readonly string[];
  readonly key: string;
  readonly restoreKeys?: readonly string[];
  readonly policy?: "pull" | "push" | "pull-push"; // default "pull-push"
}
```

FileCacheStore on-disk layout:
```
<cacheDir>/<sha256(key)>/
  manifest.json   // { key, paths, createdAt }
  <path[0]>       // copied tree(s)
  <path[1]>
  ...
```

## Error handling

- `restore()` failures are **non-fatal**: treated as a miss (the step runs).
  Logged via a `diagnostic` event (severity `warn`).
- `store()` failures are **non-fatal** (best-effort): logged via a
  `diagnostic` event (severity `warn`); the step result is unaffected.
- A step-output ref in `key`/`restoreKeys` is a **validation error** raised
  at `analyze()`/validate time (`CACHE_KEY_STEP_REF`), not at runtime.

No new error class: cache is best-effort and surfaces through the existing
`diagnostic` RunEvent. (The legacy `CacheBackend` had no error class either.)

## Test plan

1. `FileCacheStore.store` then `restore` round-trip returns the primary key
   and restores paths into `targetDir`.
2. `restore` returns `undefined` on a miss (unknown key).
3. `restore` falls back to `restoreKeys` (prefix match) and returns the
   matching restoreKey; primary-key hit is preferred over restoreKey hit.
4. Engine with a `CacheStore`: a step with `cache` and a pre-seeded store
   emits `step-cache-hit`, does **not** execute the shell operation, and
   ends `succeeded`.
5. Engine on a miss: runs the step, then `store` is called with the step's
   `paths` and resolved key.
6. `policy: "pull"` never calls `store`; `policy: "push"` never calls
   `restore` (runs the step, stores on success).
7. Context-ref key resolution: `key: "build-${{ env.NODE_VERSION }}"` with
   `NODE_VERSION=20` resolves to `build-20` before lookup.
8. Step-output ref in `key` is rejected by validation
   (`CACHE_KEY_STEP_REF`).
9. `restore` throw → step runs normally (miss), a `warn` diagnostic emitted.
10. `store` throw → step result unchanged, a `warn` diagnostic emitted.
11. Public API: `CacheStore`, `FileCacheStoreConfig`, `createFileCacheStore`,
    `CacheRestoreRequest`, `CacheRestoreResult`, `CacheStoreRequest`
    exported from `@sverka/runtime`.
12. GitHub target manifest declares `cache: lowered`, `cache.policy:
    lowered`, `cache.fallbackKeys: lowered`; GitLab unchanged (`native`).
