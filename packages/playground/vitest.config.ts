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
      // The subpath must precede the package root — a bare string find
      // also matches "<find>/<subpath>" and would splice the subpath
      // onto index.ts.
      "@sverka/sarif-viewer-web/html-generator": fileURLToPath(
        new URL("../sarif-viewer-web/src/html-generator.ts", import.meta.url),
      ),
      // Resolve workspace deps from source, not dist/ — concurrent nx
      // builds (e.g. beforeScript `bun run build` during `sverka run`)
      // rewrite dist/ mid-resolution and flake the suite with
      // "Failed to resolve entry for package".
      "@sverka/sarif-viewer-web": fileURLToPath(
        new URL("../sarif-viewer-web/src/index.ts", import.meta.url),
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
