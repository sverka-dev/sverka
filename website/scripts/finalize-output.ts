/**
 * Post-build: TanStack Start SPA emits the prerendered landing page as
 * `.output/public/_shell.html` and no root `index.html`. Static hosts
 * (Cloudflare Workers assets) look up `index.html` for `/` and for the
 * single-page-application fallback — copy the shell into place so both
 * resolve.
 */
import { copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const outDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.output/public",
);
const shell = path.join(outDir, "_shell.html");
const index = path.join(outDir, "index.html");

if (existsSync(index)) {
  console.log("index.html already present — nothing to do");
} else {
  if (!existsSync(shell)) {
    throw new Error(
      `${shell} missing — vite build did not emit the SPA shell; check the build output`,
    );
  }
  await copyFile(shell, index);
  console.log("index.html <- _shell.html");
}
