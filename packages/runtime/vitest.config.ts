import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Empty test block: knip's vitest plugin only registers default test
  // entries (src/** __tests__) when `test` is present in a resolved config.
  test: {
    // fsModuleCache defaults on in vitest 5 and shares one
    // <workspaceRoot>/node_modules/.vitest-cache across every vitest
    // process — parallel nx test targets race its lockfile-hash reset
    // and die at startup with ENOTEMPTY rmdir.
    fsModuleCache: false,
    // Scheduler, retry and host-executor tests wait on real timers and
    // child processes — they exceed vitest's 5s default under load.
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      // Resolve workspace deps from source, not dist/ — concurrent nx
      // builds (e.g. beforeScript `bun run build` during `sverka run`)
      // rewrite dist/ mid-resolution and flake the suite with
      // "Failed to resolve entry for package".
      "@sverka/workflow": fileURLToPath(
        new URL("../workflow/src/index.ts", import.meta.url),
      ),
    },
  },
});
