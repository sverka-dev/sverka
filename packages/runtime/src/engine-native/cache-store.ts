// CacheStore — content-addressed step-result caching for the native engine.
// Spec 19 — §22, §24, §25.

import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Request describing a cache restore (pull).
 */
export interface CacheRestoreRequest {
  readonly key: string;
  readonly restoreKeys: readonly string[];
  readonly paths: readonly string[];
  readonly targetDir: string;
}

/**
 * Result of a successful cache restore — the key that hit.
 */
export interface CacheRestoreResult {
  readonly key: string;
}

/**
 * Request describing a cache store (push).
 */
export interface CacheStoreRequest {
  readonly key: string;
  readonly paths: readonly string[];
  readonly sourceDir: string;
}

/**
 * Content-addressed cache store for step results. Restore failures are
 * non-fatal (treated as a miss); store failures are non-fatal (best-effort).
 * The engine wraps both in try/catch and emits `diagnostic` (warn) events.
 */
export interface CacheStore {
  restore(req: CacheRestoreRequest): Promise<CacheRestoreResult | undefined>;
  store(req: CacheStoreRequest): Promise<void>;
}

export interface FileCacheStoreConfig {
  readonly cacheDir: string;
}

interface CacheManifest {
  readonly key: string;
  readonly paths: readonly string[];
  readonly createdAt: string;
}

/**
 * Create a filesystem-backed cache store. Entries are stored under
 * `<cacheDir>/<sha256(key)>/` with a `manifest.json` and the cached path trees.
 */
export function createFileCacheStore(config: FileCacheStoreConfig): CacheStore {
  const { cacheDir } = config;

  return {
    async restore(req): Promise<CacheRestoreResult | undefined> {
      // Primary key lookup.
      const primaryDir = entryDir(cacheDir, req.key);
      if (await isDir(primaryDir)) {
        await restorePaths(primaryDir, req.paths, req.targetDir);
        return { key: req.key };
      }

      // restoreKeys fallback (prefix match on the stored key).
      for (const restoreKey of req.restoreKeys) {
        const match = await findPrefixMatch(cacheDir, restoreKey);
        if (match !== undefined) {
          await restorePaths(match.dir, req.paths, req.targetDir);
          return { key: match.key };
        }
      }
      return undefined;
    },

    async store(req): Promise<void> {
      const dir = entryDir(cacheDir, req.key);
      await mkdir(dir, { recursive: true });
      for (const path of req.paths) {
        const src = join(req.sourceDir, path);
        const dest = join(dir, path);
        await cp(src, dest, { recursive: true });
      }
      const manifest: CacheManifest = {
        key: req.key,
        paths: req.paths,
        createdAt: new Date().toISOString(),
      };
      await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest));
    },
  };
}

function entryDir(cacheDir: string, key: string): string {
  return join(cacheDir, sha256(key));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function restorePaths(entryDir: string, paths: readonly string[], targetDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  for (const path of paths) {
    const src = join(entryDir, path);
    const dest = join(targetDir, path);
    await cp(src, dest, { recursive: true });
  }
}

async function isDir(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function findPrefixMatch(
  cacheDir: string,
  prefix: string,
): Promise<{ dir: string; key: string } | undefined> {
  let entries: string[];
  try {
    entries = await readdir(cacheDir);
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    const dir = join(cacheDir, entry);
    let manifest: CacheManifest;
    try {
      manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf-8")) as CacheManifest;
    } catch {
      continue;
    }
    if (manifest.key.startsWith(prefix)) {
      return { dir, key: manifest.key };
    }
  }
  return undefined;
}
