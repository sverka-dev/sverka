// InMemorySnapshotStore — in-process SnapshotStore for tests.
// Spec 29 — suspend/resume.

import type { RunSnapshot, SnapshotStore } from "./types.js";

/**
 * Create an in-memory `SnapshotStore` that stores snapshots in a `Map`.
 * Used by engine tests and as a default when no persistence is needed.
 * Not durable — snapshots are lost when the process exits.
 */
export function createInMemorySnapshotStore(): SnapshotStore {
  const store = new Map<string, string>();
  return {
    async save(snapshot: RunSnapshot): Promise<void> {
      // Store a serialized copy to prevent alias mutations
      store.set(snapshot.runId, JSON.stringify(snapshot));
    },
    async load(runId: string): Promise<RunSnapshot | undefined> {
      const text = store.get(runId);
      if (text === undefined) return undefined;
      return JSON.parse(text) as RunSnapshot;
    },
    async delete(runId: string): Promise<void> {
      store.delete(runId);
    },
  };
}
