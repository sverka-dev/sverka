// Spec 31 — public API tests (test plan items 14, 16, 17).
import { describe, it, expect } from "vitest";
import type { SnapshotStore } from "@sverka/runtime";
import {
  createFileSnapshotStore,
  createSqliteSnapshotStore,
  StorageError,
} from "../index.js";
import type {
  FileSnapshotStoreConfig,
  SqliteSnapshotStoreConfig,
  StorageErrorCode,
} from "../index.js";

describe("@sverka/storage public API", () => {
  // Item 14: both stores satisfy SnapshotStore interface (type-level test)
  it("createFileSnapshotStore returns a SnapshotStore", () => {
    const store: SnapshotStore = createFileSnapshotStore();
    expect(typeof store.save).toBe("function");
    expect(typeof store.load).toBe("function");
    expect(typeof store.delete).toBe("function");
  });

  it("createSqliteSnapshotStore returns a SnapshotStore", () => {
    const store: SnapshotStore = createSqliteSnapshotStore({
      path: ":memory:",
    });
    expect(typeof store.save).toBe("function");
    expect(typeof store.load).toBe("function");
    expect(typeof store.delete).toBe("function");
  });

  // Item 16: exports
  it("exports createFileSnapshotStore, createSqliteSnapshotStore, StorageError, config types", () => {
    expect(createFileSnapshotStore).toBeDefined();
    expect(createSqliteSnapshotStore).toBeDefined();
    expect(StorageError).toBeDefined();
  });

  // Item 17: no any in implementation — enforced by scanning sources.
  it("implementation sources contain no `any`", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..");
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const entry of readdirSync(d)) {
        const p = join(d, entry);
        if (statSync(p).isDirectory()) {
          if (entry !== "__tests__") walk(p);
        } else if (entry.endsWith(".ts")) {
          files.push(p);
        }
      }
    };
    walk(srcDir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      // Strip comments before scanning — "any" in prose is fine, the
      // `any` type is not.
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
      expect(code).not.toMatch(/[:<,(]\s*any\b|\bas any\b|\bany\s*[\]>\],)]/);
    }
  });

  it("StorageError is constructable with both codes", () => {
    const e1 = new StorageError("STORE_IO_FAILED", "io");
    expect(e1.code).toBe("STORE_IO_FAILED");
    const e2 = new StorageError("CORRUPT_SNAPSHOT", "corrupt");
    expect(e2.code).toBe("CORRUPT_SNAPSHOT");
    const e3 = new StorageError("INVALID_RUN_ID", "bad id");
    expect(e3.code).toBe("INVALID_RUN_ID");
  });

  // Type-level: config types are usable
  it("config types are usable (type-level)", () => {
    const _fileCfg: FileSnapshotStoreConfig = { root: "/tmp" };
    const _sqliteCfg: SqliteSnapshotStoreConfig = { path: ":memory:" };
    const _code: StorageErrorCode = "STORE_IO_FAILED";
    expect(_fileCfg.root).toBe("/tmp");
    expect(_sqliteCfg.path).toBe(":memory:");
    expect(_code).toBe("STORE_IO_FAILED");
  });
});
