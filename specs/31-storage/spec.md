# Spec 31 — RunSnapshot Storage

**Status:** Active
**Source:** v1 mega-plan (sv-wthn.3); ADR-012 (snapshot-based suspend/resume); Spec 29 (defines `SnapshotStore` / `RunSnapshot`)
**Package:** `@sverka/storage` (new)
**Bead:** sv-wthn.3.2
**Depends on:** sv-wthn.3.1 (defines the `SnapshotStore` interface + `RunSnapshot` model in `@sverka/runtime`)
**Related:** ADR-014, Spec 29 (suspend/resume), Spec 10 (engine-native)

## Overview

Two durable adapters for the `SnapshotStore` interface defined in Spec 29
(`@sverka/runtime`). The engine persists a `RunSnapshot` when a step
suspends and reloads it on `Engine.resume()`. Spec 29 ships an
`InMemorySnapshotStore` (tests only); this spec ships the persistent
adapters users actually need.

- **`FileSnapshotStore`** — one JSON file per run at
  `.sverka/runs/<runId>/snapshot.json`. Zero dependencies, human-debuggable,
  the local default.
- **`SqliteSnapshotStore`** — single SQLite database via `node:sqlite`
  (built into Node 24+ and Bun, no install, no native build). Durable,
  concurrent-safe, queryable across runs.

Both implement the same three-method `SnapshotStore`. No Postgres/Redis in
v1 — the interface is the seam; concrete adapters are follow-up beads.

## Goals

- `@sverka/storage` package, depends on `@sverka/runtime` (type-only import
  of `SnapshotStore`, `RunSnapshot`).
- `FileSnapshotStore(config?)` implementing `SnapshotStore`: writes
  `JSON.stringify(snapshot)` to `<root>/.sverka/runs/<runId>/snapshot.json`.
- `SqliteSnapshotStore(config?)` implementing `SnapshotStore`: `node:sqlite`
  `DatabaseSync`, one row per run keyed by `runId`, snapshot stored as JSON
  text.
- `createFileSnapshotStore(config?)` and `createSqliteSnapshotStore(config?)`
  factories (mirror `createInMemorySnapshotStore` naming from Spec 29).
- `StorageError` with `override readonly cause`; two codes:
  `STORE_IO_FAILED` (fs/sqlite operation threw) and `CORRUPT_SNAPSHOT`
  (loaded bytes could not be parsed into a `RunSnapshot`).
- No new external dependencies. `node:sqlite`, `node:fs/promises`,
  `node:path` only.
- `node:sqlite` is experimental in Node 24; the adapter is isolated to this
  package so the experimental import never touches `@sverka/runtime`. ADR-014
  records the swap path to `better-sqlite3` if `node:sqlite` regresses.

## Non-goals

- Postgres / Redis adapters — follow-up beads; the `SnapshotStore`
  interface already accommodates them.
- A `createSnapshotStore(config)` dispatcher/factory that picks the backend
  from a config tag — YAGNI; callers construct the store they want directly.
- Snapshot retention policy / TTL / cleanup — the engine deletes on
  successful resume (Spec 29); batch cleanup is a follow-up.
- Encryption at rest — follow-up.
- Schema migrations / versioned snapshots beyond the `sverka.dev/v1run`
  envelope already carried by `RunPlan` — v1 stores and reloads the model
  verbatim.
- Storing artifacts — artifacts persist on disk in `artifactDir` and are
  reused on resume (ADR-012); the snapshot stores only scalar outputs.
- A query/CLI surface over the SQLite DB (`sverka runs list`, etc.) —
  follow-up; v1 exposes only the `SnapshotStore` contract.

## Interfaces

```ts
import type { SnapshotStore, RunSnapshot } from "@sverka/runtime";

export interface FileSnapshotStoreConfig {
  readonly root?: string;   // default process.cwd(); snapshot written to <root>/.sverka/runs/<runId>/snapshot.json
}

export interface SqliteSnapshotStoreConfig {
  readonly path?: string;   // default ".sverka/runs.db"; ":memory:" for in-process
}

export function createFileSnapshotStore(config?: FileSnapshotStoreConfig): SnapshotStore;
export function createSqliteSnapshotStore(config?: SqliteSnapshotStoreConfig): SnapshotStore;

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  override readonly cause: unknown;
  constructor(code: StorageErrorCode, message: string, cause?: unknown);
}

export type StorageErrorCode = "STORE_IO_FAILED" | "CORRUPT_SNAPSHOT";
```

`SnapshotStore` (from Spec 29, repeated for self-containment):

```ts
export interface SnapshotStore {
  save(snapshot: RunSnapshot): Promise<void>;
  load(runId: string): Promise<RunSnapshot | undefined>;
  delete(runId: string): Promise<void>;
}
```

## Data models

### File layout

```
<root>/.sverka/runs/<runId>/snapshot.json
```

`snapshot.json` is `JSON.stringify(snapshot)` (pretty-printed, 2-space, for
debuggability). `load` returns `undefined` if the file does not exist
(`ENOENT` is not an error). `delete` is idempotent (missing file is a
no-op). The `<runId>` directory is created on `save` (`mkdir -p`).

### SQLite schema

```sql
CREATE TABLE IF NOT EXISTS snapshots (
  run_id        TEXT PRIMARY KEY,
  plan_id       TEXT NOT NULL,
  status        TEXT NOT NULL,
  suspended_at  INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL
);
```

- `save` → `INSERT OR REPLACE INTO snapshots (run_id, plan_id, status, suspended_at, snapshot_json) VALUES (?, ?, ?, ?, ?)`.
- `load` → `SELECT snapshot_json FROM snapshots WHERE run_id = ?`; `undefined`
  when no row.
- `delete` → `DELETE FROM snapshots WHERE run_id = ?` (idempotent).
- The DB file's parent directory is created on construction (`mkdir -p`).
  `:memory:` skips this.
- The `DatabaseSync` is opened in the constructor and closed via a
  `close()` method on the returned store (see below).

### `close()` on the SQLite store

`node:sqlite` `DatabaseSync` holds a file handle. The `SnapshotStore`
interface has no `close`, so `createSqliteSnapshotStore` returns a
`SnapshotStore & { close(): void }`. Callers that hold the reference may
call `close()`; the engine does not (it treats the store as opaque). For
`FileSnapshotStore` no handle is held (stateless fs calls), so no
`close()`. Tests close the SQLite store in `afterEach`.

### Serialization

`RunSnapshot` is JSON-serializable: `RunPlan` carries the
`sverka.dev/v1run` envelope; `InputValue` is
`string | number | boolean | readonly string[]` (round-trips through
`JSON`). `save` uses `JSON.stringify`; `load` uses `JSON.parse` then a
structural validation of the four required fields (`runId`, `planId`,
`plan`, `completedSteps`, `suspendedStepId`, `status === "suspended"`). A
parse failure or shape mismatch throws `StorageError(CORRUPT_SNAPSHOT)`.

## Error handling

- `STORE_IO_FAILED` — wraps any `node:fs`/`node:sqlite` thrown error during
  `save`/`load`/`delete` (other than `ENOENT` on `load`, which maps to
  `undefined`). `cause` is the original error.
- `CORRUPT_SNAPSHOT` — `load` found bytes/row but `JSON.parse` or the
  required-field validation failed. `cause` is the parse error or
  `undefined` for shape mismatch.
- `StorageError` uses `override readonly cause` (project convention,
  `noImplicitOverride`).
- No retries, no transactions beyond the single-statement SQLite ops (one
  row per run; `INSERT OR REPLACE` is atomic).

## Test plan

1. `createFileSnapshotStore()` writes to
   `<cwd>/.sverka/runs/<runId>/snapshot.json`; `load` returns the same
   snapshot (deep-equal on the JSON-serializable fields).
2. `FileSnapshotStore.load` returns `undefined` for an unknown `runId`
   (no file).
3. `FileSnapshotStore.delete` is idempotent (no throw on missing file).
4. `FileSnapshotStore.save` creates nested directories that do not yet
   exist.
5. `FileSnapshotStore.load` throws `StorageError(CORRUPT_SNAPSHOT)` when
   the file exists but contains invalid JSON.
6. `FileSnapshotStore.load` throws `StorageError(CORRUPT_SNAPSHOT)` when
   JSON parses but required fields are missing / `status !== "suspended"`.
7. `createSqliteSnapshotStore({ path: ":memory:" })` round-trips a
   snapshot; `load` returns it deep-equal.
8. `SqliteSnapshotStore.load` returns `undefined` for an unknown `runId`.
9. `SqliteSnapshotStore.save` is upsert — saving twice for the same
   `runId` replaces (no duplicate rows; `load` returns the second).
10. `SqliteSnapshotStore.delete` is idempotent.
11. `SqliteSnapshotStore.load` throws `StorageError(CORRUPT_SNAPSHOT)`
    when the row's `snapshot_json` is not valid JSON or fails validation.
12. `SqliteSnapshotStore` with a file path persists across two separate
    store instances opened on the same path (close first, reopen, load).
13. `SqliteSnapshotStore` exposes `close()`; calling it and then `save`
    throws `StorageError(STORE_IO_FAILED)`.
14. Both stores satisfy the `SnapshotStore` interface (type-level test:
    assign to `SnapshotStore` variable).
15. `StorageError` sets `name === "StorageError"`, carries `code`, and
    propagates `cause`.
16. `createFileSnapshotStore`, `createSqliteSnapshotStore`,
    `FileSnapshotStoreConfig`, `SqliteSnapshotStoreConfig`,
    `StorageError`, `StorageErrorCode` exported from
    `@sverka/storage/src/index.ts`.
17. No `any` in implementation (`unknown` + narrowing).
