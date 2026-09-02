// FileSnapshotStore — JSON file per run at <root>/.sverka/runs/<runId>/snapshot.json.
// Spec 31 — File layout.

import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import process from "node:process";
import type { RunSnapshot, SnapshotStore } from "@sverka/runtime";
import { StorageError } from "./errors.js";
import { serialize, deserialize } from "./internal/serialize.js";
import { wrapIO, isENOENT } from "./internal/io-helpers.js";

export interface FileSnapshotStoreConfig {
  readonly root?: string;
}

/** Validate that a runId is safe to use as a path component (no traversal). */
function validateRunId(runId: string): void {
  if (
    runId.length === 0 ||
    runId.includes("/") ||
    runId.includes("\\") ||
    runId.includes("..") ||
    runId === "." ||
    runId.includes("\0")
  ) {
    throw new StorageError("INVALID_RUN_ID", `runId contains invalid path characters`);
  }
}

/**
 * Create a file-based `SnapshotStore`. Snapshots are written as pretty-printed
 * JSON to `<root>/.sverka/runs/<runId>/snapshot.json`. Zero dependencies,
 * human-debuggable. `load` returns `undefined` for missing files (ENOENT).
 * `delete` is idempotent. Writes are atomic (temp file + rename).
 */
export function createFileSnapshotStore(config?: FileSnapshotStoreConfig): SnapshotStore {
  const root = config?.root ?? process.cwd();

  return {
    async save(snapshot: RunSnapshot): Promise<void> {
      validateRunId(snapshot.runId);
      const dir = join(root, ".sverka", "runs", snapshot.runId);
      const finalPath = join(dir, "snapshot.json");
      const tmpPath = join(dir, `.snapshot.${randomBytes(6).toString("hex")}.tmp`);
      await wrapIO(`save snapshot ${snapshot.runId}`, async () => {
        await mkdir(dir, { recursive: true });
        await writeFile(tmpPath, serialize(snapshot), "utf8");
        await rename(tmpPath, finalPath);
      });
    },

    async load(runId: string): Promise<RunSnapshot | undefined> {
      validateRunId(runId);
      const filePath = join(root, ".sverka", "runs", runId, "snapshot.json");
      let text: string;
      try {
        text = await readFile(filePath, "utf8");
      } catch (e) {
        if (isENOENT(e)) return undefined;
        throw new StorageError("STORE_IO_FAILED", `failed to load snapshot ${runId}`, e);
      }
      return deserialize(text, runId);
    },

    async delete(runId: string): Promise<void> {
      validateRunId(runId);
      const filePath = join(root, ".sverka", "runs", runId, "snapshot.json");
      try {
        await unlink(filePath);
      } catch (e) {
        if (isENOENT(e)) return;
        throw new StorageError("STORE_IO_FAILED", `failed to delete snapshot ${runId}`, e);
      }
    },
  };
}
