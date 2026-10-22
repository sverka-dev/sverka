import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // fsModuleCache defaults on in vitest 5 and shares one
    // <workspaceRoot>/node_modules/.vitest-cache across every vitest
    // process — parallel nx test targets race its lockfile-hash reset
    // and die at startup with ENOTEMPTY rmdir.
    fsModuleCache: false,
  },
  resolve: {
    alias: {
      // Resolve workspace deps from source, not dist/ — concurrent nx
      // builds rewrite dist/ mid-resolution and flake the suite.
      "@sverka/ui": fileURLToPath(
        new URL("../ui/src/index.ts", import.meta.url),
      ),
      "@sverka/verification": fileURLToPath(
        new URL("../verification/src/index.ts", import.meta.url),
      ),
      "@sverka/sarif-viewer-web": fileURLToPath(
        new URL("../sarif-viewer-web/src/index.ts", import.meta.url),
      ),
      "@sverka/runtime": fileURLToPath(
        new URL("../runtime/src/index.ts", import.meta.url),
      ),
      "@sverka/workflow": fileURLToPath(
        new URL("../workflow/src/index.ts", import.meta.url),
      ),
    },
  },
});
