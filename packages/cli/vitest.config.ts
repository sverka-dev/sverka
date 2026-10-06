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
      // Rest of the dep closure — resolved from source so concurrent nx
      // builds rewriting dist/ can't flake suite resolution.
      "@sverka/workflow": fileURLToPath(
        new URL("../workflow/src/index.ts", import.meta.url),
      ),
      "@sverka/verification": fileURLToPath(
        new URL("../verification/src/index.ts", import.meta.url),
      ),
      "@sverka/compiler": fileURLToPath(
        new URL("../compiler/src/index.ts", import.meta.url),
      ),
      "@sverka/reporter": fileURLToPath(
        new URL("../reporter/src/index.ts", import.meta.url),
      ),
      "@sverka/sarif-viewer-tui": fileURLToPath(
        new URL("../sarif-viewer-tui/src/index.ts", import.meta.url),
      ),
      "@sverka/sarif-viewer-web": fileURLToPath(
        new URL("../sarif-viewer-web/src/index.ts", import.meta.url),
      ),
      "@sverka/ui": fileURLToPath(
        new URL("../ui/src/index.ts", import.meta.url),
      ),
    },
  },
});
