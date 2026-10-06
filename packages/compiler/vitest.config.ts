import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
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
