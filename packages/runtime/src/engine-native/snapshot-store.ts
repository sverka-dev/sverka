// InMemorySnapshotStore — in-process SnapshotStore for tests.
// Spec 29 — suspend/resume.

import type { RunSnapshot, SnapshotStore } from "./types.js";

/**
 * Create an in-memory `SnapshotStore` that stores snapshots in a `Map`.
 * Used by engine tests and as a default when no persistence is needed.
 * Not durable — snapshots are lost when the process exits.
 */
export function createInMemorySnapshotStore(): SnapshotStore {
  const store = new Map<string, RunSnapshot>();
  return {
    async save(snapshot: RunSnapshot): Promise<void> {
      store.set(snapshot.runId, snapshot);
    },
    async load(runId: string): Promise<RunSnapshot | undefined> {
      return store.get(runId);
    },
    async delete(runId: string): Promise<void> {
      store.delete(runId);
    },
  };
}
