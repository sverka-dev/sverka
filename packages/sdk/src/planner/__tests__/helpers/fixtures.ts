import { mkdtemp, mkdir, writeFile, rm, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import type { GitCli } from "../../internal/git-cli.js";

/**
 * A set of files to write into a fixture temp dir, keyed by relative path.
 */
export type FixtureFiles = Record<string, string>;

/**
 * A recorded mock GitCli. `run` dispatches based on the args:
 * - `ls-files` → trackedFiles joined by newlines
 * - `status --porcelain` → porcelainLines joined by newlines
 * - `rev-parse HEAD` → headSha
 * - `rev-parse --show-toplevel` → root
 * - `diff --name-status <base>..HEAD` → diffNameStatus
 * - `--version` → "git version 2.43.0"
 *
 * Any unrecognized command rejects with an Error so tests fail loudly if
 * discover() calls something unexpected.
 */
export interface MockGitConfig {
  root: string;
  trackedFiles?: string[];
  porcelainLines?: string[];
  headSha?: string;
  diffNameStatus?: string;
  /** When true, `git --version` rejects (simulates git not on PATH). */
  gitUnavailable?: boolean;
  /** When true, `rev-parse --show-toplevel` rejects (not a repo). */
  notARepo?: boolean;
}

export function makeMockGit(cfg: MockGitConfig): GitCli {
  const tracked = cfg.trackedFiles ?? [];
  const porcelain = cfg.porcelainLines ?? [];
  const head = cfg.headSha ?? "abc123def4567890abc123def4567890abc123de";
  const diff = cfg.diffNameStatus ?? "";
  return {
    run(args) {
      const joined = args.join(" ");
      return new Promise<string>((resolvePromise, reject) => {
        if (cfg.gitUnavailable && joined.includes("--version")) {
          reject(Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" }));
          return;
        }
        if (cfg.notARepo && joined.includes("--show-toplevel")) {
          reject(new Error("not a git repository", { cause: "fatal: not a git repository" }));
          return;
        }
        if (joined === "--version") {
          resolvePromise("git version 2.43.0\n");
          return;
        }
        if (joined === "rev-parse --show-toplevel") {
          resolvePromise(`${cfg.root}\n`);
          return;
        }
        if (joined === "rev-parse HEAD") {
          resolvePromise(`${head}\n`);
          return;
        }
        if (joined === "ls-files") {
          resolvePromise(tracked.map((f) => f).join("\n") + (tracked.length ? "\n" : ""));
          return;
        }
        if (joined === "status --porcelain" || joined === "status --porcelain -uall") {
          resolvePromise(porcelain.join("\n") + (porcelain.length ? "\n" : ""));
          return;
        }
        if (args[0] === "diff" && args[1] === "--name-status") {
          resolvePromise(diff + (diff ? "\n" : ""));
          return;
        }
        reject(new Error(`makeMockGit: unhandled git command: git ${joined}`));
      });
    },
  };
}

/**
 * Create a temp dir and write the given files into it. Returns the absolute
 * root path. Call `cleanup(root)` to remove it.
 */
export async function makeFixtureDir(files: FixtureFiles): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sverka-planner-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
  }
  return root;
}

/** Remove a fixture dir created by `makeFixtureDir`. */
export async function cleanup(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}

/**
 * Recursively list all files under `root` (relative paths). Used by the
 * side-effect-freedom test to snapshot the tree before and after discover().
 */
export async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, base: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const rel = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name), rel);
      } else {
        out.push(rel);
      }
    }
  }
  await walk(root, "");
  out.sort();
  return out;
}

/** Read a file under root as UTF-8 text (for asserting contents). */
export { stat };
