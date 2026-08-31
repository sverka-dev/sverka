// Spec 31 — FileSnapshotStore tests (test plan items 1–6).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { createFileSnapshotStore } from "../file-store.js";
import { StorageError } from "../errors.js";
import { makeSnapshot, makeTempDir, cleanupTempDir } from "./helpers/fixtures.js";

describe("FileSnapshotStore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  // Item 1: save + load round-trip
  it("writes to <root>/.sverka/runs/<runId>/snapshot.json and load returns same snapshot", async () => {
    const store = createFileSnapshotStore({ root: dir });
    const snap = makeSnapshot("run-1");
    await store.save(snap);

    const expectedPath = join(dir, ".sverka", "runs", "run-1", "snapshot.json");
    expect(existsSync(expectedPath)).toBe(true);

    const loaded = await store.load("run-1");
    expect(loaded).toEqual(snap);
  });

  // Item 2: load returns undefined for unknown runId
  it("load returns undefined for unknown runId (no file)", async () => {
    const store = createFileSnapshotStore({ root: dir });
    const loaded = await store.load("nonexistent");
    expect(loaded).toBeUndefined();
  });

  // Item 3: delete is idempotent
  it("delete is idempotent (no throw on missing file)", async () => {
    const store = createFileSnapshotStore({ root: dir });
    await expect(store.delete("nonexistent")).resolves.toBeUndefined();
  });

  // Item 4: save creates nested directories
  it("save creates nested directories that do not yet exist", async () => {
    const store = createFileSnapshotStore({ root: dir });
    const snap = makeSnapshot("run-nested");
    await store.save(snap);
    const snapPath = join(dir, ".sverka", "runs", "run-nested", "snapshot.json");
    expect(existsSync(snapPath)).toBe(true);
  });

  // Item 5: load throws CORRUPT_SNAPSHOT for invalid JSON
  it("load throws StorageError(CORRUPT_SNAPSHOT) when file has invalid JSON", async () => {
    const store = createFileSnapshotStore({ root: dir });
    const snapDir = join(dir, ".sverka", "runs", "run-bad");
    await mkdir(snapDir, { recursive: true });
    await writeFile(join(snapDir, "snapshot.json"), "{ not valid json");

    await expect(store.load("run-bad")).rejects.toThrow(StorageError);
    try {
      await store.load("run-bad");
    } catch (e) {
      expect((e as StorageError).code).toBe("CORRUPT_SNAPSHOT");
    }
  });

  // Item 6: load throws CORRUPT_SNAPSHOT when JSON parses but required fields missing / status !== suspended
  it("load throws CORRUPT_SNAPSHOT when JSON parses but status !== suspended", async () => {
    const store = createFileSnapshotStore({ root: dir });
    const snapDir = join(dir, ".sverka", "runs", "run-wrong-status");
    await mkdir(snapDir, { recursive: true });
    const bad = JSON.stringify({ ...makeSnapshot(), status: "success" });
    await writeFile(join(snapDir, "snapshot.json"), bad);

    await expect(store.load("run-wrong-status")).rejects.toThrow(StorageError);
  });

  it("load throws CORRUPT_SNAPSHOT when required fields are missing", async () => {
    const store = createFileSnapshotStore({ root: dir });
    const snapDir = join(dir, ".sverka", "runs", "run-missing");
    await mkdir(snapDir, { recursive: true });
    await writeFile(join(snapDir, "snapshot.json"), JSON.stringify({ foo: "bar" }));

    await expect(store.load("run-missing")).rejects.toThrow(StorageError);
  });

  it("delete removes the snapshot file", async () => {
    const store = createFileSnapshotStore({ root: dir });
    const snap = makeSnapshot("run-del");
    await store.save(snap);
    const snapPath = join(dir, ".sverka", "runs", "run-del", "snapshot.json");
    expect(existsSync(snapPath)).toBe(true);
    await store.delete("run-del");
    expect(existsSync(snapPath)).toBe(false);
  });

  it("save then delete then load returns undefined", async () => {
    const store = createFileSnapshotStore({ root: dir });
    const snap = makeSnapshot("run-cycle");
    await store.save(snap);
    await store.delete("run-cycle");
    const loaded = await store.load("run-cycle");
    expect(loaded).toBeUndefined();
  });
});
