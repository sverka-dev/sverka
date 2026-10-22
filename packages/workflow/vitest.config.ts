import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // fsModuleCache defaults on in vitest 5 and shares one
    // <workspaceRoot>/node_modules/.vitest-cache across every vitest
    // process — parallel nx test targets race its lockfile-hash reset
    // and die at startup with ENOTEMPTY rmdir.
    fsModuleCache: false,
    // The workflow package builds definition graphs and drives the
    // planner — under the parallel CI load a single test can exceed
    // vitest's 5s default and fail on timing, not on behavior. Same
    // reasoning as the CLI package.
    testTimeout: 30000,
  },
});
