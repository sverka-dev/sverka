import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");

export default defineConfig({
  root: ".",
  build: {
    outDir: "dist-web",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
  resolve: {
    alias: {
      // Resolve browser-safe HTML generator directly from source
      "@sverka/sarif-viewer-web/html-generator": resolve(
        __dirname,
        "../sarif-viewer-web/src/html-generator.ts",
      ),
    },
  },
});
