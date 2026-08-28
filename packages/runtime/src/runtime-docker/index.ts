// @sverka/runtime-docker — public API
//
// Exports both the old Executor-based API (DockerExecutor) for the SDK compat
// layer and the new driver-based API (createDockerDriver) for the Wave L CLI.
// The old API will be removed when the SDK compat layer is dropped.

// Old API (SDK compat)
export { DockerExecutor } from "./docker-executor.js";
export { type DockerExecutorConfig } from "./config.js";
export { type CacheManager, DockerCacheManager } from "./cache.js";

// New API (Wave F+ driver)
export { createDockerDriver, buildDockerArgs } from "./docker-driver.js";
export type { DockerDriverConfig } from "./config.js";

// Shared
export { verifyImageDigest } from "./image.js";
export { DockerExecutorError, ImageDigestError, ContainerPolicyError }
  from "./errors.js";
