# ADR-014 — Storage: Separate Package, `node:sqlite`, Two Adapters

**Status:** Active
**Date:** 2026-08-31
**Related:** ADR-012 (suspend/resume snapshot), Spec 29, Spec 31

## Context

Spec 29 (suspend/resume) defines the `SnapshotStore` interface and an
`InMemorySnapshotStore` inside `@sverka/runtime`. sv-wthn.3.2 requires
durable adapters. Two questions:

1. **Separate package or inline in `@sverka/runtime`?**
2. **Which SQLite binding, and do we also need a plain file store?**

## Decision

1. **Separate `@sverka/storage` package.** `@sverka/runtime` is otherwise
   pure TypeScript (only `@sverka/workflow` dep). SQLite — even built-in
   `node:sqlite` — is an experimental module import and a storage concern
   that Wave 4 engines and signals/saga will also consume. Isolating it
   keeps `@sverka/runtime` pure and gives cross-cutting storage a home.
   The package depends on `@sverka/runtime` type-only for the
   `SnapshotStore` / `RunSnapshot` contract.

2. **`node:sqlite` (built into Node 24+ and Bun) for the SQLite adapter.**
   Zero install, zero native build, works under both runtimes the project
   targets. It is experimental in Node 24 (prints a warning); the adapter
   is isolated to `@sverka/storage` so the experimental import never
   touches `@sverka/runtime`. If `node:sqlite` regresses or is removed,
   swapping to `better-sqlite3` is a one-file change behind the same
   `SnapshotStore` interface — no consumer changes.

3. **Ship two adapters, not one.**
   - `FileSnapshotStore` — JSON file per run at
     `.sverka/runs/<runId>/snapshot.json`. Zero deps, human-debuggable,
     the local default. Covers the single-process HITL case (one snapshot
     per suspended run, low write frequency) with nothing but `node:fs`.
   - `SqliteSnapshotStore` — single DB via `node:sqlite`. Durable,
     concurrent-safe, queryable. For server / multi-run / future-run-history
     use.
   Both are small (~40 lines each). Shipping both honestly covers the two
   use cases the mega-plan describes ("SQLite default" + ".sverka/runs/
   snapshot.json for local") without pretending one store fits both.

4. **No Postgres/Redis in v1.** The `SnapshotStore` interface is the
   pluggability seam; concrete adapters are follow-up beads. No
   `createSnapshotStore(config)` dispatcher — YAGNI; callers construct the
   store they want.

## Rationale

The minimalist critique considered shipping only `FileSnapshotStore`
(zero-dep, covers v1 HITL). Rejected because the mega-plan explicitly
positions storage as a foundation for Wave 4 durability and the bead is
scoped to SQLite; `node:sqlite` being built-in removes the usual
native-dep cost of SQLite, so the marginal complexity of the second
adapter is ~40 lines. The reverse (ship only SQLite) was also considered:
rejected because the JSON-per-run layout is materially more debuggable for
HITL and removes even the experimental-module import for the common local
case.

## Consequences

- New `@sverka/storage` package; nx/tsdown scaffolding.
- `@sverka/runtime` gains `SnapshotStore` / `RunSnapshot` /
  `createInMemorySnapshotStore` exports (from Spec 29 impl, sv-wthn.3.1).
- `@sverka/storage` depends on `@sverka/runtime` (workspace, type-only).
- `StorageError` (2 codes) added in `@sverka/storage`.
- Follow-ups: Postgres/Redis adapters, retention/TTL, `sverka runs list`
  CLI, encryption at rest, swap to `better-sqlite3` if `node:sqlite`
  regresses.
