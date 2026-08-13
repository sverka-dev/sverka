// ArtifactStore — filesystem-based artifact transfer between Steps.
// Spec 10 — §22.1 component 8.

import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ArtifactStore } from "./types.js";
import { EngineError } from "./errors.js";

/** Create a filesystem-backed ArtifactStore under the given root directory. */
export function createArtifactStore(rootDir: string): ArtifactStore {
  return {
    async store(stepId: string, outputName: string, sourcePath: string): Promise<string> {
      const destDir = join(rootDir, stepId);
      const destPath = join(destDir, outputName);
      try {
        await mkdir(destDir, { recursive: true });
        await copyRecursive(sourcePath, destPath);
        return destPath;
      } catch (e) {
        throw new EngineError(
          `failed to store artifact '${outputName}' from '${sourcePath}': ${e instanceof Error ? e.message : String(e)}`,
          "ARTIFACT_ERROR",
          e,
        );
      }
    },

    async retrieve(stepId: string, outputName: string, destPath: string): Promise<string> {
      const srcPath = join(rootDir, stepId, outputName);
      try {
        await mkdir(join(destPath, ".."), { recursive: true });
        await copyRecursive(srcPath, destPath);
        return destPath;
      } catch (e) {
        throw new EngineError(
          `failed to retrieve artifact '${outputName}' for step '${stepId}': ${e instanceof Error ? e.message : String(e)}`,
          "ARTIFACT_ERROR",
          e,
        );
      }
    },
  };
}

/** Copy a file or directory recursively. */
async function copyRecursive(src: string, dest: string): Promise<void> {
  const s = await stat(src);
  if (s.isDirectory()) {
    await mkdir(dest, { recursive: true });
    const entries = await readdir(src);
    for (const entry of entries) {
      await copyRecursive(join(src, entry), join(dest, entry));
    }
  } else {
    await copyFile(src, dest);
  }
}
