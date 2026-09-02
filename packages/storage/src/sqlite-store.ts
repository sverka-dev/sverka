// SqliteSnapshotStore — SQLite database via node:sqlite (built into Node 24+ and Bun).
// Spec 31 — SQLite schema.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { RunSnapshot, SnapshotStore } from "@sverka/runtime";
import { StorageError } from "./errors.js";
import { serialize, deserialize } from "./internal/serialize.js";
import { wrapIO } from "./internal/io-helpers.js";

export interface SqliteSnapshotStoreConfig {
  readonly path?: string;
}

const DEFAULT_PATH = ".sverka/runs.db";

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS snapshots (
    run_id        TEXT PRIMARY KEY,
    plan_id       TEXT NOT NULL,
    status        TEXT NOT NULL,
    suspended_at  INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL
  )
`;

/**
 * Create a SQLite-backed `SnapshotStore` using `node:sqlite` (built into
 * Node 24+ and Bun, no install, no native build). One row per run keyed by
 * `runId`; snapshot stored as JSON text. Returns `SnapshotStore & { close(): void }`
 * — callers may call `close()` to release the `DatabaseSync` handle.
 */
export function createSqliteSnapshotStore(
  config?: SqliteSnapshotStoreConfig,
): SnapshotStore & { close(): void } {
  const path = config?.path ?? DEFAULT_PATH;

  if (path !== ":memory:") {
    try {
      mkdirSync(dirname(path), { recursive: true });
    } catch {
      // Directory may already exist or parent is "." — ignore.
    }
  }

  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path);
  } catch (e) {
    throw new StorageError("STORE_IO_FAILED", `failed to open sqlite database at ${path}`, e);
  }
  try {
    db.exec(CREATE_TABLE_SQL);
  } catch (e) {
    try { db.close(); } catch { /* ignore */ }
    throw new StorageError("STORE_IO_FAILED", `failed to initialize sqlite schema at ${path}`, e);
  }

  let saveStmt: ReturnType<DatabaseSync["prepare"]>;
  let loadStmt: ReturnType<DatabaseSync["prepare"]>;
  let deleteStmt: ReturnType<DatabaseSync["prepare"]>;
  try {
    saveStmt = db.prepare(
      "INSERT OR REPLACE INTO snapshots (run_id, plan_id, status, suspended_at, snapshot_json) VALUES (?, ?, ?, ?, ?)",
    );
    loadStmt = db.prepare("SELECT snapshot_json FROM snapshots WHERE run_id = ?");
    deleteStmt = db.prepare("DELETE FROM snapshots WHERE run_id = ?");
  } catch (e) {
    try { db.close(); } catch { /* ignore */ }
    throw new StorageError("STORE_IO_FAILED", `failed to prepare sqlite statements at ${path}`, e);
  }

  return {
    async save(snapshot: RunSnapshot): Promise<void> {
      await wrapIO(`save snapshot ${snapshot.runId}`, () => {
        saveStmt.run(
          snapshot.runId,
          snapshot.planId,
          snapshot.status,
          snapshot.suspendedAt,
          serialize(snapshot),
        );
      });
    },

    async load(runId: string): Promise<RunSnapshot | undefined> {
      let row: { snapshot_json?: string } | undefined;
      try {
        row = loadStmt.get(runId) as { snapshot_json?: string } | undefined;
      } catch (e) {
        throw new StorageError("STORE_IO_FAILED", `failed to load snapshot ${runId}`, e);
      }
      if (row === undefined) return undefined;
      const text = row["snapshot_json"];
      if (typeof text !== "string") {
        throw new StorageError("CORRUPT_SNAPSHOT", `snapshot_json is not a string for ${runId}`);
      }
      return deserialize(text, runId);
    },

    async delete(runId: string): Promise<void> {
      try {
        deleteStmt.run(runId);
      } catch (e) {
        throw new StorageError("STORE_IO_FAILED", `failed to delete snapshot ${runId}`, e);
      }
    },

    close(): void {
      try {
        db.close();
      } catch {
        // Already closed — ignore.
      }
    },
  };
}
