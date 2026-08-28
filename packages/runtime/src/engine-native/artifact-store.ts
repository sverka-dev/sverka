// ArtifactStore — filesystem-based artifact transfer between Steps.
// Spec 10 — §22.1 component 8.

import { copyFile, lstat, mkdir, readdir } from "node:fs/promises";
import { isAbsolute, join, normalize, relative } from "node:path";
import type { ArtifactStore } from "./types.js";
import { EngineError } from "./errors.js";

/** Create a filesystem-backed ArtifactStore under the given root directory. */
export function createArtifactStore(rootDir: string): ArtifactStore {
  const safeRoot = normalize(rootDir);

  return {
    async store(stepId: string, outputName: string, sourcePath: string): Promise<string> {
      const destDir = resolveStepDir(safeRoot, stepId);
      assertSafeFileName(outputName);
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
      const srcDir = resolveStepDir(safeRoot, stepId);
      assertSafeFileName(outputName);
      const srcPath = join(srcDir, outputName);
      try {
        await mkdir(normalize(join(destPath, "..")), { recursive: true });
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

function resolveStepDir(root: string, stepId: string): string {
  if (isAbsolute(stepId)) {
    throw new EngineError(`step id must be relative: '${stepId}'`, "ARTIFACT_ERROR");
  }
  const resolved = normalize(join(root, stepId));
  const rel = relative(root, resolved);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new EngineError(`step id escapes artifact root: '${stepId}'`, "ARTIFACT_ERROR");
  }
  return resolved;
}

function assertSafeFileName(name: string): void {
  if (!name || name === "." || name === "..") {
    throw new EngineError(`invalid artifact name: '${name}'`, "ARTIFACT_ERROR");
  }
  if (isAbsolute(name) || name.includes("/") || name.includes("\\")) {
    throw new EngineError(`artifact name must be a base name: '${name}'`, "ARTIFACT_ERROR");
  }
}

/** Copy a file or directory recursively without following symlinks. */
async function copyRecursive(src: string, dest: string): Promise<void> {
  const s = await lstat(src);
  if (s.isSymbolicLink()) {
    throw new EngineError(`refusing to follow symlink: '${src}'`, "ARTIFACT_ERROR");
  }
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
