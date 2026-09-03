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
import { FileSnapshotStore } from "@sverka/storage";

const store = new FileSnapshotStore({
  dir: "./.sverka/snapshots",
});
```

### SQLite store

Stores snapshots in a SQLite database. Suitable for local persistent runs
that survive process restarts.

```ts
import { SqliteSnapshotStore } from "@sverka/storage";

const store = new SqliteSnapshotStore({
  path: "./.sverka/snapshots.db",
});
```

### In-memory store

For tests and ephemeral runs. Not persistent across process restarts.

```ts
import { InMemorySnapshotStore } from "@sverka/runtime";

const store = new InMemorySnapshotStore();
```

## API

```ts
interface SnapshotStore {
  save(runId: string, snapshot: RunSnapshot): Promise<void>;
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

The storage layer validates snapshot integrity on load. Corrupt snapshots
raise a `StorageError` with code `CORRUPT_SNAPSHOT`, including the run ID
and the validation failure reason. The file store uses atomic writes
(temp file + rename) to prevent partial-write corruption.
