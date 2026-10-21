import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The workflow package builds definition graphs and drives the
    // planner — under the parallel CI load a single test can exceed
    // vitest's 5s default and fail on timing, not on behavior. Same
    // reasoning as the CLI package.
    testTimeout: 30000,
  },
});
