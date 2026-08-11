import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // CLI tests invoke the SDK (plan/execute) and shell commands (doctor),
    // which are slower under WSL. Allow up to 30s per test.
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      "@sverka/sdk": new URL("../sdk/src/index.ts", import.meta.url).pathname,
    },
  },
});
