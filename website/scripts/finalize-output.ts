/**
 * Post-build: TanStack Start SPA emits the prerendered landing page as
 * `.output/public/_shell.html` and no root `index.html`. Static hosts
 * (Cloudflare Workers assets) look up `index.html` for `/` and for the
 * single-page-application fallback — copy the shell into place so both
 * resolve.
 */
import { copyFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const outDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.output/public",
);
const shell = path.join(outDir, "_shell.html");
const index = path.join(outDir, "index.html");

try {
  await access(index);
  console.log("index.html already present — nothing to do");
} catch {
  await copyFile(shell, index);
  console.log("index.html <- _shell.html");
}
