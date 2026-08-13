import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // CLI tests invoke the SDK (plan/execute) and shell commands (doctor),
    // which are slower under WSL. Allow up to 30s per test.
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      "@sverka/sdk": fileURLToPath(
        new URL("../sdk/src/index.ts", import.meta.url),
      ),
      // The SDK compat layer dynamically imports these runtime packages.
      // Alias them to source so vitest resolves them without requiring
      // a build step and without relying on node_modules resolution.
      "@sverka/runtime": fileURLToPath(
        new URL("../runtime/src/index.ts", import.meta.url),
      ),
      "@sverka/runtime-host": fileURLToPath(
        new URL("../runtime-host/src/index.ts", import.meta.url),
      ),
      "@sverka/runtime-docker": fileURLToPath(
        new URL("../runtime-docker/src/index.ts", import.meta.url),
      ),
    },
  },
});
