// @sverka/runtime-host — public API
//
// Exports both the old Executor-based API (HostExecutor) for the SDK compat
// layer and the new driver-based API (createHostDriver) for the Wave L CLI.
// The old API will be removed when the SDK compat layer is dropped.

// Old API (SDK compat)
export { HostExecutor } from "./host-executor.js";
export { type HostExecutorConfig } from "./config.js";

// New API (Wave F+ driver)
export { createHostDriver } from "./host-driver.js";
export type { HostDriverConfig } from "./config.js";

// Shared
export { type CommandAllowlist, createAllowlist } from "./allowlist.js";
export { HostExecutorError, HostDriverError, HostTimeoutError, CommandNotAllowedError }
  from "./errors.js";
