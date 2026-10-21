import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["__tests__/**/*.test.ts"],
    exclude: ["fixtures/**", "node_modules/**", "dist/**"],
    // The git-registry tests drive real `git` processes (clone, pull
    // --rebase, push) against local bare remotes. Under a loaded CI
    // runner a single rebase round exceeds vitest's 5s default and the
    // test fails on timing, not on behavior.
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      // Resolve workspace deps from source, not dist/ — concurrent nx
      // builds (e.g. beforeScript `bun run build` during `sverka run`)
      // rewrite dist/ mid-resolution and flake the suite with
      // "Failed to resolve entry for package".
      "@sverka/reporter": fileURLToPath(
        new URL("../reporter/src/index.ts", import.meta.url),
      ),
      "@sverka/runtime": fileURLToPath(
        new URL("../runtime/src/index.ts", import.meta.url),
      ),
      "@sverka/verification": fileURLToPath(
        new URL("../verification/src/index.ts", import.meta.url),
      ),
      "@sverka/workflow": fileURLToPath(
        new URL("../workflow/src/index.ts", import.meta.url),
      ),
    },
  },
});
