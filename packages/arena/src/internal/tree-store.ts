/**
 * TreeStore — the uniform read/write view over a registry tree shared by
 * every backend (file/git/s3), plus the local-directory implementation.
 * Not exported from the package index.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ArenaError } from "../config.js";

/** Uniform read/write view over the registry tree per backend. */
export interface TreeStore {
  readFile(rel: string): Promise<string | null>;
  writeFile(rel: string, data: string): Promise<void>;
  /** Relative posix paths under relPrefix, recursive. */
  listFiles(relPrefix: string): Promise<string[]>;
  /**
   * Re-sync remote state before a read operation — the git backend
   * re-pulls (its clone is memoized, so without this a long-lived
   * registry never sees pushes that landed after first access).
   * File/s3 backends don't implement it.
   */
  refresh?(): Promise<void>;
  /** Commit/publish pending writes — git commits + pushes; others no-op. */
  finalize(message: string): Promise<void>;
}

/** Strip trailing '/' without a regex — a `\/+$` match on a hostile
 * prefix (many trailing slashes + a non-slash tail) backtracks
 * quadratically (CodeQL js/polynomial-redos, SonarCloud S8786). */
export function stripTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.codePointAt(end - 1) === 47) end--;
  return s.slice(0, end);
}

export function createFileTree(dir: string): TreeStore {
  const unavailable = (what: string, cause: unknown): ArenaError =>
    new ArenaError(
      `registry unavailable — ${what} under ${dir}`,
      "REGISTRY_UNAVAILABLE",
      cause,
    );
  return {
    async readFile(rel) {
      try {
        return await readFile(join(dir, rel), "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw unavailable(`cannot read ${rel}`, err);
      }
    },
    async writeFile(rel, data) {
      const target = join(dir, rel);
      try {
        await mkdir(join(target, ".."), { recursive: true });
        // 0o600 — registry roots may live under tmpdir(); keep the
        // created file owner-only (CodeQL js/insecure-temporary-file).
        await writeFile(target, data, { encoding: "utf8", mode: 0o600 });
      } catch (err) {
        throw unavailable(`cannot write ${rel}`, err);
      }
    },
    async listFiles(relPrefix) {
      // Subtree walks are independent — fanned out in one Promise.all
      // (entry order is preserved by map/flat, so the listing stays
      // deterministic).
      const walk = async (rel: string): Promise<string[]> => {
        let entries;
        try {
          entries = await readdir(join(dir, rel), { withFileTypes: true });
        } catch (err) {
          // Only ENOENT means "empty subtree" — permission or I/O
          // failures must surface (a silent empty list would let
          // `reindex` overwrite index.json with nothing).
          if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
          throw unavailable(`cannot list ${rel}`, err);
        }
        const subtrees = await Promise.all(
          entries.map((e): Promise<string[]> | string[] => {
            const child = rel === "" ? e.name : `${rel}/${e.name}`;
            if (e.isDirectory()) return walk(child);
            return e.isFile() ? [child] : [];
          }),
        );
        return subtrees.flat();
      };
      // A trailing "/" in relPrefix would seed children as "results//x"
      // — and split("/")[3] on that yields the agent segment, not the
      // date. Normalize so returned paths stay canonical.
      return walk(stripTrailingSlashes(relPrefix));
    },
    async finalize() {},
  };
}
