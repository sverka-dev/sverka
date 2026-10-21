import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The CLI and public-API tests spawn the built CLI in a child
    // process — they exceed vitest's 5s default under load.
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      // Resolve workspace deps from source, not dist/ — concurrent nx
      // builds (e.g. beforeScript `bun run build` during `sverka run`)
      // rewrite dist/ mid-resolution and flake the suite with
      // "Failed to resolve entry for package".
      "@sverka/verification": fileURLToPath(
        new URL("../verification/src/index.ts", import.meta.url),
      ),
      "@sverka/workflow": fileURLToPath(
        new URL("../workflow/src/index.ts", import.meta.url),
      ),
    },
  },
});
