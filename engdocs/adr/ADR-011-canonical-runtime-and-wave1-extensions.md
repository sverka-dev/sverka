# ADR-011 — Canonical Runtime: engine-native, and v1 Wave 1 Extensions

**Status:** Active
**Date:** 2026-08-31
**Supersedes:** none (extends ADR-009, ADR-004)

## Context

After the v0 redesign (waves A–N) and the package collapse refactor (PR #119,
18 → 6 packages), `@sverka/runtime` contains **two parallel runtime
implementations** in one package:

| Sub-module | Model | Streaming | Cache | Retry | State persist | Used by |
|---|---|---|---|---|---|---|
| `engine-native/` | `RunPlan` / `StepDefinition` (§22) | `AsyncIterable<RunEvent>` (10 events) | no | no | no | CLI `sverka run` |
| `runtime/` | `Plan` / `PlanOperation` (legacy) | none (returns `ExecutionResult`) | yes (`CacheBackend`) | yes (`executeWithRetry`) | yes (`StateStore`) | SDK `execute` path |

`StepDefinition` (in `@sverka/workflow` cdk/model.ts) already declares
`retry?: RetryPolicy` and `cache?: CacheSpec`, and `synthesize()` propagates
both onto the graph. But **engine-native ignores them** — it runs each step
exactly once with no cache lookup. The legacy `runtime/` scheduler honors
`op.retry` / `op.cache` but operates on the old `Plan` model and emits no
events.

v1 Wave 1 (sv-wthn.1) adds four P0 features: CacheStore, RetryPolicy,
RunEvent, GHA action SHA pinning. Three of the four touch the runtime.

## Decision

1. **`engine-native` is the canonical native engine.** It is the reference
   implementation of §22 and the only runtime that satisfies the §21 Engine
   contract (`run → AsyncIterable<RunEvent>`). Wave 1 cache + retry are
   implemented **in engine-native**, not in the legacy `runtime/` scheduler.

2. **The legacy `runtime/` scheduler is compat-only.** It remains for the
   SDK `execute` path (which still imports `Scheduler`). It is NOT extended
   in Wave 1. Migrating the SDK `execute` path onto engine-native is a
   follow-up bead (out of Wave 1 scope) — see "Follow-ups" below.

3. **RunEvent is already implemented; Wave 1 extends it.** The 10 existing
   event types in `engine-native/types.ts` are the protocol. Wave 1 adds two
   variants — `step-cache-hit` and `step-retry` — driven by the cache and
   retry features. Spec 21 documents the full protocol.

4. **Model fields already exist; one extension.** `RetryPolicy` gains an
   optional `backoff?: BackoffSpec` (`{ baseMs; maxMs?; factor? }`) to satisfy
   the mega-plan's "exponential backoff" requirement. `CacheSpec` is used
   as-is (no model change).

5. **No new packages.** All Wave 1 code lands in existing packages:
   `@sverka/runtime` (engine-native cache + retry + events),
   `@sverka/workflow` (BackoffSpec on RetryPolicy),
   `@sverka/compiler` (github SHA pinning).

## Consequences

- Cache/retry added to the canonical engine only. The SDK `execute` path
  keeps using the legacy scheduler and will NOT gain the new features until
  it migrates. This is accepted: Wave 1 delivers the features to the
  canonical engine + CLI; SDK migration is decoupled.
- `policy.cache` capability is added to target manifests (GitHub: `lowered`
  via `actions/cache`, GitLab: `native`, native engine: `native`).
- `policy.retry` GitHub manifest entry moves from `unsupported` to
  `emulated` (lowered to a composite retry wrapper) — but the GHA retry
  *lowering* itself is a follow-up; Wave 1 only implements native-engine
  retry and documents the capability level.

## Follow-ups (out of Wave 1 scope, to be filed as beads)

- **SDK execute → engine-native migration** (deprecate legacy `runtime/`
  scheduler). Blocked on engine-native gaining state-persistence/resume
  (Wave 3) so the SDK does not lose resume capability.
- **GHA retry lowering** — emit a composite retry wrapper for
  `policy.retry: emulated`.
- **Cache key ref-substitution for step refs** — Wave 1 resolves context
  refs only (env/git/matrix/inputs); step-ref keys are disallowed (validate).
- **Cache eviction / size limits / compression** — not in v1 Wave 1.
- **Retry jitter** — not in v1 Wave 1.
