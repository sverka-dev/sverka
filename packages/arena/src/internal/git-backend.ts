/**
 * Git registry backend — clone → write → commit → push, behind the
 * TreeStore contract. Checkouts are memoized per dir; all git-mutating
 * ops on a checkout serialize through one promise queue.
 * Not exported from the package index.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ArenaError } from "../config.js";
import { git, gitOrThrow } from "./git.js";
import { ensurePrivateDir } from "./private-dir.js";
import { buildIndex, INDEX_PATH, writeIndex } from "./registry-index.js";
import { createFileTree, type TreeStore } from "./tree-store.js";

export interface GitRegistryConfig {
  /** Clone URL — https or git@. */
  url: string;
  /** Branch to publish on (default: "main"). */
  branch?: string;
  /** Local checkout dir (default: a tmp cache keyed by URL). */
  dir?: string;
  /** Bearer token for https remotes (header-scoped, never persisted). */
  token?: string;
}

export function gitRegistryDir(cfg: GitRegistryConfig): string {
  return (
    cfg.dir ??
    join(
      tmpdir(),
      `arena-registry-${createHash("sha256").update(cfg.url).digest("hex").slice(0, 12)}`,
    )
  );
}

/**
 * Auth is injected through GIT_CONFIG_* env vars, never argv — a
 * `-c http.extraHeader=...` argument would expose the bearer token to
 * other users on the host via the process list (CWE-214).
 */
function gitAuthEnv(cfg: GitRegistryConfig): Record<string, string> {
  return cfg.token !== undefined && /^https?:\/\//.test(cfg.url)
    ? {
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "http.extraHeader",
        GIT_CONFIG_VALUE_0: `AUTHORIZATION: bearer ${cfg.token}`,
      }
    : {};
}

const gitUnavailable =
  (cfg: GitRegistryConfig, dir: string) =>
  (what: string, cause: unknown): ArenaError =>
    new ArenaError(
      `registry unavailable — ${what} (${cfg.url} → ${dir})`,
      "REGISTRY_UNAVAILABLE",
      cause,
    );

function rebaseInProgress(dir: string): boolean {
  return (
    existsSync(join(dir, ".git", "rebase-merge")) ||
    existsSync(join(dir, ".git", "rebase-apply"))
  );
}

/**
 * Best-effort re-sync of an existing checkout. A stopped rebase (a
 * killed publish, or a version before abort-on-failure) poisons every
 * later git op, so it is aborted first. fetch alone only moves
 * origin/<branch>; pull --ff-only refreshes the worktree — a checkout
 * holding unpublished commits (a failed publish) can't ff and stays
 * as-is; publish's own pull --rebase reconciles it. Only when HEAD is
 * the registry branch: ff-ing some other checked-out branch would
 * silently move it.
 */
async function ffPullCheckout(
  dir: string,
  branch: string,
  auth: Record<string, string>,
): Promise<void> {
  if (rebaseInProgress(dir)) {
    await git(["-C", dir, "rebase", "--abort"], { env: auth });
  }
  const head = await git(["-C", dir, "symbolic-ref", "-q", "--short", "HEAD"], {
    env: auth,
  });
  if (head.code === 0 && head.stdout.trim() === branch) {
    await git(["-C", dir, "pull", "--ff-only", "origin", branch], {
      env: auth,
    });
  }
}

const checkouts = new Map<
  string,
  { url: string; branch: string; p: Promise<void> }
>();

/**
 * Clone-or-refresh a git registry checkout (memoized per dir). Soft on
 * refresh when a checkout exists — a stale local view stays readable;
 * publish does its own pull --rebase anyway.
 */
export function ensureGitCheckout(cfg: GitRegistryConfig): Promise<void> {
  const dir = gitRegistryDir(cfg);
  const branch = cfg.branch ?? "main";
  const auth = gitAuthEnv(cfg);
  const unavailable = gitUnavailable(cfg, dir);
  const existing = checkouts.get(dir);
  if (existing !== undefined) {
    // The memo binds a dir to its first url+branch — silently reusing
    // it for another registry would publish to the wrong remote.
    if (existing.url !== cfg.url || existing.branch !== branch) {
      throw new ArenaError(
        `registry unavailable — checkout ${dir} is bound to ${existing.url} (branch ${existing.branch}), not ${cfg.url} (branch ${branch})`,
        "REGISTRY_UNAVAILABLE",
      );
    }
    return existing.p;
  }
  const p = (async () => {
    if (cfg.dir === undefined) {
      // The auto-derived tmpdir path is predictable (URL hash) — a
      // foreign pre-created dir would supply its own .git/config
      // (core.fsmonitor, core.sshCommand) and hooks running as us.
      // Verify type+owner+mode before trusting an existing checkout
      // (CWE-377). A user-supplied cfg.dir is the caller's choice and
      // is not re-checked here.
      await ensurePrivateDir(dir, "registry checkout", "REGISTRY_UNAVAILABLE");
    }
    if (existsSync(join(dir, ".git"))) {
      // An adopted checkout must belong to THIS registry — an explicit
      // cfg.dir at a clone of another remote would publish to it.
      const origin = await git(["-C", dir, "remote", "get-url", "origin"], {
        env: auth,
      });
      if (origin.code !== 0 || origin.stdout.trim() !== cfg.url) {
        throw unavailable(
          `checkout remote is not '${cfg.url}'`,
          origin.stderr.trim(),
        );
      }
      // A checkout on a different branch would publish that branch's
      // tip to '${branch}' — HEAD:branch pushes whatever is checked
      // out. Detached HEAD carries no branch claim; adopt it.
      const head = await git(
        ["-C", dir, "symbolic-ref", "-q", "--short", "HEAD"],
        { env: auth },
      );
      if (head.code === 0 && head.stdout.trim() !== branch) {
        throw unavailable(
          `checkout is on branch '${head.stdout.trim()}', not '${branch}'`,
          undefined,
        );
      }
      await ffPullCheckout(dir, branch, auth);
      return;
    }
    try {
      await gitOrThrow(
        [
          "clone",
          ...(cfg.branch !== undefined ? ["--branch", cfg.branch] : []),
          cfg.url,
          dir,
        ],
        { env: auth },
      );
    } catch (err) {
      throw unavailable(`git clone failed`, err);
    }
  })();
  checkouts.set(dir, { url: cfg.url, branch, p });
  // A failed clone must not poison the memo — retry next call. The
  // identity check keeps a concurrent fresh entry from being removed.
  p.catch(() => {
    if (checkouts.get(dir)?.p === p) checkouts.delete(dir);
  });
  return p;
}

const GIT_IDENTITY = [
  "-c",
  "user.name=sverka-arena",
  "-c",
  "user.email=arena@sverka.dev",
];

const gitOps = new Map<string, Promise<unknown>>();

/**
 * Serialize git-mutating operations per checkout dir — a refresh pull
 * racing publish's add/commit would fail on index.lock, and a stopped
 * rebase observed under the lock is dead (a live one holds the queue
 * through finalize), so the holder may safely abort it.
 */
function serializedGitOp<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const run = (gitOps.get(dir) ?? Promise.resolve()).then(fn);
  gitOps.set(
    dir,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

/**
 * Registry-owned paths — the only paths finalize stages. A checkout can
 * collect strays (tool tmp litter in the auto-derived cache, scratch
 * files in a user-provided cfg.dir); a bare `git add -A` would commit
 * and push them, so the stage is scoped to the registry namespace
 * instead. Everything in results/ belongs — reindex deliberately
 * supports results dropped into the checkout out-of-band.
 */
const REGISTRY_PATHS = ["results", "traces", "packs", INDEX_PATH] as const;

export function createGitTree(
  cfg: GitRegistryConfig,
): TreeStore & { dir: string } {
  const dir = gitRegistryDir(cfg);
  const branch = cfg.branch ?? "main";
  const auth = gitAuthEnv(cfg);
  const inner = createFileTree(dir);
  const unavailable = gitUnavailable(cfg, dir);
  const ensure = (): Promise<void> => ensureGitCheckout(cfg);
  const inRebase = (): boolean => rebaseInProgress(dir);

  /**
   * One stopped-commit round. Two publishers racing always collide on
   * index.json — each commit rewrites it — while result/trace paths are
   * per-run and never conflict. index.json is a pure function of the
   * results/ tree (reindex semantics), so a conflicted rebase whose only
   * unmerged path is index.json is resolved by regenerating it and
   * continuing. Anything else is a real conflict: give up and let the
   * caller abort.
   */
  async function resolveRebaseRound(): Promise<boolean> {
    const unmerged = await git(
      ["-C", dir, "diff", "--name-only", "--diff-filter=U"],
      { env: auth },
    );
    if (unmerged.code !== 0) return false;
    const paths = unmerged.stdout.split("\n").filter((l) => l !== "");
    if (paths.length === 0 || paths.some((p) => p !== INDEX_PATH)) {
      return false;
    }
    const { index } = await buildIndex(inner);
    await writeIndex(inner, index);
    const add = await git(["-C", dir, "add", "--", INDEX_PATH], {
      env: auth,
    });
    if (add.code !== 0) return false;
    // --continue either finishes the rebase or stops at the next
    // conflicted commit — the caller re-checks unmerged paths.
    await git(["-C", dir, ...GIT_IDENTITY, "rebase", "--continue"], {
      env: { ...auth, GIT_EDITOR: "true" },
    });
    return true;
  }

  /**
   * Resolve every stopped commit in the current rebase. Recurses rather
   * than loops so the rounds read as what they are — sequential steps,
   * each depending on the previous rebase state. Async recursion builds
   * microtask frames, not stack frames, so a checkout replaying many
   * unpublished commits (repeated PUBLISH_CONFLICTs) stays resolvable.
   */
  async function resolveRebaseConflicts(): Promise<boolean> {
    if (!inRebase()) return true;
    if (!(await resolveRebaseRound())) return false;
    return resolveRebaseConflicts();
  }

  async function pullRebase(): Promise<void> {
    // Rebase replays our commit — it needs a committer identity too, and
    // hosts without a global gitconfig (CI) have none.
    const res = await git(
      ["-C", dir, ...GIT_IDENTITY, "pull", "--rebase", "origin", branch],
      { env: auth },
    );
    if (res.code === 0) return;
    if (!inRebase()) {
      // The pull failed before any rebase started (fetch/auth/network).
      throw unavailable(`git pull --rebase failed`, res.stderr.trim());
    }
    const resolved = await resolveRebaseConflicts().catch(() => false);
    if (!resolved) {
      // A failed rebase must never be left in place — a mid-rebase
      // checkout poisons every later git op in this dir.
      await git(["-C", dir, "rebase", "--abort"], { env: auth });
      throw unavailable(`git pull --rebase failed`, res.stderr.trim());
    }
  }

  async function push(): Promise<ReturnType<typeof git>> {
    return git(["-C", dir, "push", "origin", `HEAD:${branch}`], {
      env: auth,
    });
  }

  return {
    dir,
    async readFile(rel) {
      await ensure();
      return inner.readFile(rel);
    },
    async writeFile(rel, data) {
      await ensure();
      return inner.writeFile(rel, data);
    },
    async listFiles(relPrefix) {
      await ensure();
      return inner.listFiles(relPrefix);
    },
    /**
     * Best-effort re-sync before a read — one `pull --ff-only` per call,
     * serialized against publish's git ops on this checkout. Every step
     * is soft: a stopped rebase found here is dead (a live publish holds
     * the queue) so it's aborted; a non-ff/dirty/offline pull just
     * leaves the stale view, which stays readable — publish reconciles
     * through its own pull --rebase.
     */
    async refresh() {
      await serializedGitOp(dir, async () => {
        await ensure(); // a failed clone is real unavailability — throws
        await ffPullCheckout(dir, branch, auth);
      });
    },
    async finalize(message) {
      // Serialized with refresh — a pull must never interleave with
      // add/commit/rebase on this checkout.
      await serializedGitOp(dir, async () => {
        await ensure();
        // Unstage whatever an outside `git add` left behind in a
        // user-provided checkout — it would otherwise ride this commit.
        await git(["-C", dir, "reset", "--quiet"], { env: auth });
        // git add errors on a pathspec that matches nothing — a missing
        // path simply has nothing to stage.
        const scope = REGISTRY_PATHS.filter((p) => existsSync(join(dir, p)));
        try {
          if (scope.length > 0) {
            await gitOrThrow(["-C", dir, "add", "-A", "--", ...scope]);
          }
        } catch (err) {
          throw unavailable(`git add failed`, err);
        }
        const staged = await git(["-C", dir, "diff", "--cached", "--quiet"]);
        if (staged.code === 0) return; // nothing to commit
        try {
          await gitOrThrow([
            "-C",
            dir,
            ...GIT_IDENTITY,
            "commit",
            "-m",
            message,
          ]);
        } catch (err) {
          throw unavailable(`git commit failed`, err);
        }
        let res = await push();
        if (res.code !== 0) {
          // Non-fast-forward (or auth failure indistinguishable from it):
          // one rebase retry — results are append-only, never force-pushed.
          await pullRebase();
          res = await push();
          if (res.code !== 0) {
            throw new ArenaError(
              `publish rejected — git push to '${cfg.url}' failed after rebase retry; ` +
                `results are preserved in the local checkout at ${dir}`,
              "PUBLISH_CONFLICT",
              res.stderr.trim(),
            );
          }
        }
      });
    },
  };
}
