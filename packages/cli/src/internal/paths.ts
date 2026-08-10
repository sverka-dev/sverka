import { isAbsolute, join } from "node:path";

/**
 * Resolve a path against a root directory. Absolute paths are returned
 * unchanged; relative paths are joined under `root` so that `--root` governs
 * path resolution regardless of the process working directory.
 */
export function resolveUnderRoot(root: string, path: string): string {
  return isAbsolute(path) ? path : join(root, path);
}
