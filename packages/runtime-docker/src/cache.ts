import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

/**
 * Manages cache inputs and outputs for Docker execution. Cache directories
 * are bind-mounted into the container at `/cache`.
 */
export interface CacheManager {
  /** Prepare a cache directory for an operation's declared inputs. */
  prepare(inputs: readonly string[], key: string): Promise<string>;
  /** Collect cache outputs after execution. */
  collect(outputs: readonly string[], sourceDir: string): Promise<void>;
}

/**
 * Filesystem-backed cache manager. `prepare` creates `<cacheDir>/<key>` and
 * copies declared inputs into it. `collect` copies declared outputs back into
 * the persistent `cacheDir`, preserving relative path structure.
 */
export class DockerCacheManager implements CacheManager {
  constructor(private readonly cacheDir: string) {}

  async prepare(inputs: readonly string[], key: string): Promise<string> {
    const target = join(this.cacheDir, key);
    await mkdir(target, { recursive: true });
    for (const input of inputs) {
      const dest = join(target, relative(dirname(input), input));
      await mkdir(dirname(dest), { recursive: true });
      // Only copy if the source exists; if not, the cached copy may already
      // be present from a prior run (restore-from-cache semantics).
      try {
        await stat(input);
        await copyFile(input, dest);
      } catch {
        // Source missing — rely on existing cached copy (if any).
      }
    }
    return target;
  }

  async collect(outputs: readonly string[], sourceDir: string): Promise<void> {
    for (const output of outputs) {
      const rel = relative(sourceDir, output);
      const dest = join(this.cacheDir, rel);
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(output, dest);
    }
  }
}
