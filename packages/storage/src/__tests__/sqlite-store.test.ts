// Spec 31 — SqliteSnapshotStore tests (test plan items 7–13).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { createSqliteSnapshotStore } from "../sqlite-store.js";
import { StorageError } from "../errors.js";
import { makeSnapshot, makeTempDir, cleanupTempDir } from "./helpers/fixtures.js";

describe("SqliteSnapshotStore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  // Item 7: round-trip with :memory:
  it("round-trips a snapshot with :memory: path", async () => {
    const store = createSqliteSnapshotStore({ path: ":memory:" });
    const snap = makeSnapshot("run-1");
    await store.save(snap);
    const loaded = await store.load("run-1");
    expect(loaded).toEqual(snap);
  });

  // Item 8: load returns undefined for unknown runId
  it("load returns undefined for unknown runId", async () => {
    const store = createSqliteSnapshotStore({ path: ":memory:" });
    const loaded = await store.load("nonexistent");
    expect(loaded).toBeUndefined();
  });

  // Item 9: save is upsert
  it("save is upsert — saving twice replaces (no duplicate rows)", async () => {
    const store = createSqliteSnapshotStore({ path: ":memory:" });
    const base = makeSnapshot("run-upsert");
    const snap1 = { ...base, completedSteps: [{ stepId: "ci/build", outputs: { result: "first" } }] };
    await store.save(snap1);

    const snap2 = { ...base, completedSteps: [{ stepId: "ci/build", outputs: { result: "second" } }] };
    await store.save(snap2);

    const loaded = await store.load("run-upsert");
    expect(loaded).toEqual(snap2);
  });

  // Item 10: delete is idempotent
  it("delete is idempotent", async () => {
    const store = createSqliteSnapshotStore({ path: ":memory:" });
    await expect(store.delete("nonexistent")).resolves.toBeUndefined();
  });

  // Item 11: load throws CORRUPT_SNAPSHOT for invalid JSON in row
  it("load throws CORRUPT_SNAPSHOT when row snapshot_json is invalid JSON", async () => {
    // Use a file-path DB, insert corrupt data via a second connection, then load.
    const dbPath = join(dir, "corrupt.db");
    const store = createSqliteSnapshotStore({ path: dbPath });
    // Insert a valid snapshot first to create the table
    const snap = makeSnapshot("run-ok");
    await store.save(snap);
    store.close();

    // Open a raw connection and corrupt the row
    const { DatabaseSync } = await import("node:sqlite");
    const rawDb = new DatabaseSync(dbPath);
    rawDb.exec(
      "INSERT OR REPLACE INTO snapshots (run_id, plan_id, status, suspended_at, snapshot_json) VALUES ('run-corrupt', 'p', 'suspended', 0, '{ not valid json')",
    );
    rawDb.close();

    const store2 = createSqliteSnapshotStore({ path: dbPath });
    await expect(store2.load("run-corrupt")).rejects.toThrow(StorageError);
    try {
      await store2.load("run-corrupt");
    } catch (e) {
      expect((e as StorageError).code).toBe("CORRUPT_SNAPSHOT");
    }
    store2.close();
  });

  // Item 12: persists across two separate store instances on the same file path
  it("persists across two separate store instances on the same file path", async () => {
    const dbPath = join(dir, "runs.db");
    const store1 = createSqliteSnapshotStore({ path: dbPath });
    const snap = makeSnapshot("run-persist");
    await store1.save(snap);
    store1.close();

    const store2 = createSqliteSnapshotStore({ path: dbPath });
    const loaded = await store2.load("run-persist");
    expect(loaded).toEqual(snap);
    store2.close();
  });

  // Item 13: close() then save throws STORE_IO_FAILED
  it("close() then save throws StorageError(STORE_IO_FAILED)", async () => {
    const store = createSqliteSnapshotStore({ path: ":memory:" });
    store.close();
    const snap = makeSnapshot("run-after-close");
    await expect(store.save(snap)).rejects.toThrow(StorageError);
    try {
      await store.save(snap);
    } catch (e) {
      expect((e as StorageError).code).toBe("STORE_IO_FAILED");
    }
  });

  it("delete removes the snapshot", async () => {
    const store = createSqliteSnapshotStore({ path: ":memory:" });
    const snap = makeSnapshot("run-del");
    await store.save(snap);
    await store.delete("run-del");
    const loaded = await store.load("run-del");
    expect(loaded).toBeUndefined();
  });
});
