# Spec 40 — Conformance Suite Expansion (v1)

**Status:** Active
**Source:** specs/architecture-spec.md §33 (Conformance), §34 (Acceptance Criteria)
**Package:** `@sverka/conformance` (restored — test-only package)
**Capability:** N/A (acceptance gate, not a target/engine)
**Related:** ADR-017, Spec 18 (conformance v0), ADR-016 (Wave 4 targets)

## Overview

Restore `@sverka/conformance` as a test-only package that verifies v1
features produce valid Definition Graphs, compile to all targets
(GitHub, GitLab, Drone, Temporal, Dagger, Inngest), and execute
correctly through the native engine. This is the v1 acceptance gate —
every v1 feature gets conformance tests.

## Goals

- Restore `@sverka/conformance` package (test-only, no runtime exports).
- Conformance seed: build → test → deploy pipeline authored via all 4
  surfaces (Construct, SDK, Decorator, Markdown).
- v1 feature coverage: caching, retries, suspend/resume, saga, MCP
  server, agent steps, safe-outputs, network allowlist, run queries,
  all 6 targets (GitHub/GitLab/Drone + Temporal/Dagger/Inngest).
- Cross-surface equivalence: all 4 surfaces produce equivalent graphs.
- Cross-target compilation: seed compiles to all 6 targets without
  errors (unsupported capabilities emit diagnostics, not errors).
- Serialization round-trip: graph → JSON → graph equality.
- Engine execution: seed runs through native engine successfully.

## Non-goals

- Performance benchmarks — out of scope.
- Cross-engine execution (Temporal/Dagger/Inngest execution) — those are
  code-gen targets, not execution engines (ADR-016).
- Conformance for legacy v0 packages — only v1 features.
- CI integration / GitHub Actions workflow for conformance — follow-up.
- Conformance reporting dashboard — follow-up.

## Interfaces

No public API exports. The package contains only vitest test files. It
depends on all Sverka packages and runs cross-cutting acceptance tests.

```ts
// No exports — test-only package
// package.json has no "main" / "exports" — only "test" script
```

## Data models

### Test structure

```
packages/conformance/
  package.json         (test-only: vitest, no main/exports)
  tsconfig.json
  vitest.config.ts
  __tests__/
    seed.test.ts           — cross-surface equivalence (4 surfaces)
    targets.test.ts        — compile seed to all 6 targets
    serialization.test.ts  — graph round-trip
    engine.test.ts         — native engine execution
    caching.test.ts        — cache hit/miss conformance
    retry.test.ts          — retry policy conformance
    suspend-resume.test.ts — suspend/resume conformance
    saga.test.ts           — saga compensation conformance
    agent.test.ts          — agent step conformance (stub driver)
    safe-outputs.test.ts   — write declarations + permissions
    network.test.ts        — network allowlist conformance
    queries.test.ts        — run query conformance
    markdown.test.ts       — markdown authoring conformance
```

### Conformance seed

The seed pipeline (build → test → deploy) is authored 4 ways:

1. **Construct API**: `new Project` + `new Pipeline` + `new ShellStep`
2. **SDK API**: `pipeline()` + `$` tagged template
3. **Decorator API**: `@pipeline` + `@step` class
4. **Markdown API**: `parseMarkdown()` from a markdown string

All 4 must synthesize to equivalent Definition Graphs (same step IDs,
same dependencies, same operations, same triggers).

### v1 feature conformance tests

Each v1 feature gets a focused test that:
1. Builds a graph using that feature.
2. Synthesizes successfully (no errors).
3. Compiles to all 6 targets (diagnostics OK, no throw).
4. Serializes + deserializes round-trip.
5. (Where applicable) executes through native engine.

## Error handling

No error classes — test-only package. Test failures are the error
signal. Tests use `expect()` assertions.

## Test plan

1. Seed via Construct API synthesizes to valid graph.
2. Seed via SDK API synthesizes to valid graph.
3. Seed via Decorator API synthesizes to valid graph.
4. Seed via Markdown API synthesizes to valid graph.
5. All 4 seed graphs are equivalent (deep equality after canonicalization).
6. Seed compiles to GitHub target (no throw, valid YAML).
7. Seed compiles to GitLab target (no throw, valid YAML).
8. Seed compiles to Drone target (no throw, valid YAML).
9. Seed compiles to Temporal target (no throw, valid TS).
10. Seed compiles to Dagger target (no throw, valid TS).
11. Seed compiles to Inngest target (no throw, valid TS).
12. Graph serialization round-trip: serialize → deserialize → equality.
13. Seed executes through native engine (mock driver, success status).
14. Caching: step with cache spec → cache-hit on second run.
15. Retry: step with retry policy → retries on failure.
16. Suspend/resume: step suspends → snapshot saved → resume continues.
17. Saga: step with compensation → compensation runs on failure.
18. Agent step: stub agent driver → step succeeds with agent result.
19. Safe-outputs: step with write declarations → permissions enforced.
20. Network allowlist: step with network spec → diagnostic emitted.
21. Run query: engine.query() returns correct RunState.
22. Markdown: parseMarkdown → valid Project → synthesizes.
23. All tests pass with `bun run test --filter @sverka/conformance`.
