import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { DockerExecutorError } from "./errors.js";

/**
 * Manages cache inputs and outputs for Docker execution. Cache directories
 * are bind-mounted into the container at `/cache`.
 */
export interface CacheManager {
  /** Prepare a cache directory for an operation's declared inputs. */
  prepare(
    inputs: readonly string[],
    key: string,
    workspace?: string,
  ): Promise<string>;
  /** Collect cache outputs after execution. */
  collect(outputs: readonly string[], sourceDir: string, key: string): Promise<void>;
}

/**
 * Filesystem-backed cache manager. `prepare` creates `<cacheDir>/<key>` and
 * copies declared inputs into it. `collect` copies declared outputs from the
 * execution `sourceDir` back into the same `<cacheDir>/<key>` directory,
 * preserving relative path structure.
 */
export class DockerCacheManager implements CacheManager {
  constructor(private readonly cacheDir: string) {}

  async prepare(
    inputs: readonly string[],
    key: string,
    workspace?: string,
  ): Promise<string> {
    const target = this.resolveCachePath(key);
    await mkdir(target, { recursive: true });
    for (const input of inputs) {
      const root = workspace ?? dirname(input);
      const rel = isAbsolute(input) ? relative(root, input) : input;
      if (rel.startsWith("..") || isAbsolute(rel)) {
        throw new DockerExecutorError(
          `cache input "${input}" escapes workspace "${root}"`,
          "CACHE_PATH_ESCAPE",
        );
      }
      const dest = join(target, rel);
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

  async collect(
    outputs: readonly string[],
    sourceDir: string,
    key: string,
  ): Promise<void> {
    const target = this.resolveCachePath(key);
    for (const rawOutput of outputs) {
      const output = isAbsolute(rawOutput)
        ? relative(sourceDir, rawOutput)
        : rawOutput;
      if (output.startsWith("..")) {
        throw new DockerExecutorError(
          `cache output "${rawOutput}" escapes sourceDir "${sourceDir}"`,
          "CACHE_PATH_ESCAPE",
        );
      }
      const src = resolve(sourceDir, output);
      this.assertInsideDir(src, sourceDir, `cache output "${rawOutput}"`);
      const dest = resolve(target, output);
      if (normalize(src) === normalize(dest)) {
        continue;
      }
      await mkdir(dirname(dest), { recursive: true });
      try {
        await copyFile(src, dest);
      } catch (e) {
        // A missing or unreadable cache output should not abort the whole
        // execution; continue collecting the remaining outputs.
        if (
          e instanceof Error &&
          "code" in e &&
          (e as { code: string }).code === "ENOENT"
        ) {
          continue;
        }
        throw new DockerExecutorError(
          `failed to collect cache output "${rawOutput}": ${e instanceof Error ? e.message : String(e)}`,
          "CACHE_COLLECT_FAILED",
          { output: rawOutput, source: src, dest },
        );
      }
    }
  }

  private resolveCachePath(key: string): string {
    if (isAbsolute(key)) {
      throw new DockerExecutorError(
        `absolute cache key "${key}" is not allowed`,
        "CACHE_KEY_ESCAPE",
      );
    }
    const target = resolve(this.cacheDir, key);
    this.assertInsideDir(target, this.cacheDir, `cache key "${key}"`);
    return target;
  }

  private assertInsideDir(path: string, root: string, what: string): void {
    const rel = relative(resolve(root), path);
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return;
    throw new DockerExecutorError(
      `${what} escapes cacheDir "${root}"`,
      "CACHE_PATH_ESCAPE",
    );
  }
}
