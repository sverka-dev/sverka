// @sverka/storage — durable SnapshotStore adapters.
// Spec 31 — RunSnapshot Storage.

export { createFileSnapshotStore } from "./file-store.js";
export { createSqliteSnapshotStore } from "./sqlite-store.js";
export { StorageError } from "./errors.js";
export type { StorageErrorCode } from "./errors.js";
export type { FileSnapshotStoreConfig } from "./file-store.js";
export type { SqliteSnapshotStoreConfig } from "./sqlite-store.js";
