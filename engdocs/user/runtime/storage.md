# Snapshot storage

> **Work in progress.** The storage package is implemented with file and
> SQLite adapters. APIs may change.

The `@sverka/storage` package provides persistent snapshot storage for
suspend/resume (Spec 29). It stores `RunSnapshot` objects — the minimal
state needed to resume a suspended run: completed steps, their scalar
outputs, the suspended step id, and the resume schema.

## Adapters

### File store

Stores snapshots as JSON files in a directory. Each snapshot is written
atomically (temp file + rename) to prevent corruption from interrupted
writes.

```ts
import { createFileSnapshotStore } from "@sverka/storage";

const store = createFileSnapshotStore({
  root: ".",  // snapshots written to ./.sverka/runs/<runId>/snapshot.json
});
```

### SQLite store

Stores snapshots in a SQLite database. Suitable for local persistent runs
that survive process restarts.

```ts
import { createSqliteSnapshotStore } from "@sverka/storage";

const store = createSqliteSnapshotStore({
  path: "./.sverka/snapshots.db",
});
```

### In-memory store

For tests and ephemeral runs. Not persistent across process restarts.

```ts
import { createInMemorySnapshotStore } from "@sverka/runtime";

const store = createInMemorySnapshotStore();
```

## API

```ts
interface SnapshotStore {
  save(snapshot: RunSnapshot): Promise<void>;
  load(runId: string): Promise<RunSnapshot | undefined>;
  delete(runId: string): Promise<void>;
}
```

## RunSnapshot model

```ts
interface RunSnapshot {
  runId: string;
  planId: string;
  startedAt: number;
  suspendedStepId: string;
  resumeSchema?: { required?: readonly string[] };
  completedSteps: Array<{
    stepId: string;
    outputs: Record<string, string>;
    durationMs: number;
  }>;
}
```

## Corruption handling

Persistent adapters (file, SQLite) validate snapshot integrity on load.
Corrupt snapshots raise a `StorageError` with code `CORRUPT_SNAPSHOT`,
including the run ID and the validation failure reason. The file store
uses atomic writes (temp file + rename) to prevent partial-write
corruption. The in-memory store does not perform validation — it returns
objects as stored.
