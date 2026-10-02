// FileSnapshotStore — JSON file per run at <root>/.sverka/runs/<runId>/snapshot.json.
// Spec 31 — File layout.

import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
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
    throw new StorageError(
      "INVALID_RUN_ID",
      `runId contains invalid path characters`,
    );
  }
}

/**
 * Create a file-based `SnapshotStore`. Snapshots are written as pretty-printed
 * JSON to `<root>/.sverka/runs/<runId>/snapshot.json`. Zero dependencies,
 * human-debuggable. `load` returns `undefined` for missing files (ENOENT).
 * `delete` is idempotent. Writes are atomic (temp file + rename).
 */
export function createFileSnapshotStore(
  config?: FileSnapshotStoreConfig,
): SnapshotStore {
  const root = config?.root ?? process.cwd();

  return {
    async save(snapshot: RunSnapshot): Promise<void> {
      validateRunId(snapshot.runId);
      const dir = join(root, ".sverka", "runs", snapshot.runId);
      const finalPath = join(dir, "snapshot.json");
      const tmpPath = join(
        dir,
        `.snapshot.${randomBytes(6).toString("hex")}.tmp`,
      );
      await wrapIO(`save snapshot ${snapshot.runId}`, async () => {
        // Reject symlinked store dirs before mkdir/chmod — a symlink planted
        // at .sverka or runs would redirect writes outside root, and chmod
        // would tighten the unrelated target directory.
        for (const p of [join(root, ".sverka"), join(root, ".sverka", "runs")]) {
          try {
            if ((await lstat(p)).isSymbolicLink()) {
              throw new StorageError(
                "STORE_IO_FAILED",
                `store directory is a symlink: ${p}`,
              );
            }
          } catch (err) {
            if (!isENOENT(err)) throw err;
          }
        }
        await mkdir(dir, { recursive: true, mode: 0o700 });
        // mode only applies at creation — chmod an existing dir too, but
        // never follow a planted symlink: chmod(dir) would otherwise
        // tighten an unrelated target directory.
        if ((await lstat(dir)).isSymbolicLink()) {
          throw new StorageError(
            "STORE_IO_FAILED",
            `run directory is a symlink: ${dir}`,
          );
        }
        await chmod(dir, 0o700);
        try {
          await writeFile(tmpPath, serialize(snapshot), {
            encoding: "utf8",
            mode: 0o600,
          });
          await rename(tmpPath, finalPath);
        } catch (e) {
          // Don't leave tmp files behind — repeated failures would
          // accumulate under .sverka/runs.
          await unlink(tmpPath).catch(() => {});
          throw e;
        }
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
        throw new StorageError(
          "STORE_IO_FAILED",
          `failed to load snapshot ${runId}`,
          e,
        );
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
        throw new StorageError(
          "STORE_IO_FAILED",
          `failed to delete snapshot ${runId}`,
          e,
        );
      }
    },
  };
}
