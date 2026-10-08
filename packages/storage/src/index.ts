// @sverka/storage — durable SnapshotStore adapters, remote hub client,
// and tiered cache composition.
// Spec 31 — RunSnapshot Storage. Spec 55 — Remote Run Hub.

export { createFileSnapshotStore } from "./file-store.js";
export { createSqliteSnapshotStore } from "./sqlite-store.js";
export { StorageError, HubError } from "./errors.js";
export type { StorageErrorCode, HubErrorCode } from "./errors.js";
export type { FileSnapshotStoreConfig } from "./file-store.js";
export type { SqliteSnapshotStoreConfig } from "./sqlite-store.js";
export {
  createRemoteCacheStore,
  createRemoteSnapshotStore,
  createRemoteCircuit,
  uploadRunReport,
  listRuns,
  getRun,
} from "./remote.js";
export type {
  RemoteStoreConfig,
  RemoteCircuit,
  HubRunSummary,
  HubRunDetail,
  RunUploadMeta,
  RunUploadResult,
} from "./remote.js";
export { createTieredCacheStore } from "./tiered-cache.js";
export type { TieredCacheStoreConfig } from "./tiered-cache.js";
