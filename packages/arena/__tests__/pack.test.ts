import { describe, it, expect, afterAll } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ArenaError } from "../src/config.js";
import { gitOrThrow } from "../src/internal/git.js";
import { initPack, lintPack, loadPack, resolvePack } from "../src/pack.js";

const dir = mkdtempSync(join(tmpdir(), "arena-pack-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function expectPackError(
  p: Promise<unknown>,
  code: string,
): Promise<ArenaError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ArenaError);
    expect((e as ArenaError).code).toBe(code);
    return e as ArenaError;
  }
  throw new Error(`expected ArenaError(${code}), got success`);
}

describe("initPack + lintPack", () => {
  it("scaffold passes lint", async () => {
    const packDir = join(dir, "demo");
    await initPack(packDir, "demo");
    expect(existsSync(join(packDir, "pack.json"))).toBe(true);
    expect(existsSync(join(packDir, "tasks", "example-task.json"))).toBe(true);
    const { errors } = await lintPack(packDir);
    expect(errors).toEqual([]);
  });

  it("refuses to scaffold into a non-empty dir", async () => {
    const packDir = join(dir, "taken");
    mkdirSync(packDir, { recursive: true });
    writeFileSync(join(packDir, "x.txt"), "occupied");
    await expectPackError(initPack(packDir, "taken"), "PACK_INVALID");
  });
});

describe("loadPack", () => {
  it("loads tasks, applies pack defaults, derives ids from filenames", async () => {
    const packDir = join(dir, "loadable");
    mkdirSync(join(packDir, "tasks"), { recursive: true });
    mkdirSync(join(packDir, "fixture-dir"), { recursive: true });
    writeFileSync(
      join(packDir, "pack.json"),
      JSON.stringify({
        name: "loadable",
        defaults: { timeoutMs: 60_000, repetitions: 2 },
      }),
    );
    writeFileSync(
      join(packDir, "tasks", "a.json"),
      JSON.stringify({ prompt: "do a", fixture: "fixture-dir" }),
    );
    writeFileSync(
      join(packDir, "tasks", "b.json"),
      JSON.stringify({
        id: "custom-b",
        prompt: "do b",
        timeoutMs: 5000,
        checks: [{ id: "c1", command: "true" }],
      }),
    );
    const pack = await loadPack(packDir);
    expect(pack.name).toBe("loadable");
    expect(pack.defaults.repetitions).toBe(2);
    const a = pack.tasks.find((t) => t.id === "a")!;
    expect(a.timeoutMs).toBe(60_000); // default applied
    expect(a.fixture).toBe(join(packDir, "fixture-dir"));
    const b = pack.tasks.find((t) => t.id === "custom-b")!;
    expect(b.timeoutMs).toBe(5000); // task override wins
    expect(b.checks![0]).toMatchObject({ id: "c1", command: "true" });
  });

  it("missing pack.json → PACK_NOT_FOUND", async () => {
    await expectPackError(loadPack(join(dir, "nope")), "PACK_NOT_FOUND");
  });

  it("invalid pack.json → PACK_INVALID", async () => {
    const packDir = join(dir, "bad-meta");
    mkdirSync(packDir, { recursive: true });
    writeFileSync(join(packDir, "pack.json"), JSON.stringify({ ver: 1 }));
    await expectPackError(loadPack(packDir), "PACK_INVALID");
  });

  it("a pack with no tasks → PACK_INVALID", async () => {
    const packDir = join(dir, "empty");
    mkdirSync(join(packDir, "tasks"), { recursive: true });
    writeFileSync(join(packDir, "pack.json"), JSON.stringify({ name: "e" }));
    await expectPackError(loadPack(packDir), "PACK_INVALID");
  });

  it("duplicate task ids → PACK_INVALID", async () => {
    const packDir = join(dir, "dupes");
    mkdirSync(join(packDir, "tasks"), { recursive: true });
    writeFileSync(join(packDir, "pack.json"), JSON.stringify({ name: "d" }));
    writeFileSync(
      join(packDir, "tasks", "a.json"),
      JSON.stringify({ id: "same", prompt: "x" }),
    );
    writeFileSync(
      join(packDir, "tasks", "b.json"),
      JSON.stringify({ id: "same", prompt: "y" }),
    );
    const err = await expectPackError(loadPack(packDir), "PACK_INVALID");
    expect(err.message).toContain("same");
  });

  it("missing fixture dir → PACK_INVALID", async () => {
    const packDir = join(dir, "no-fixture");
    mkdirSync(join(packDir, "tasks"), { recursive: true });
    writeFileSync(join(packDir, "pack.json"), JSON.stringify({ name: "n" }));
    writeFileSync(
      join(packDir, "tasks", "a.json"),
      JSON.stringify({ prompt: "x", fixture: "ghost" }),
    );
    await expectPackError(loadPack(packDir), "PACK_INVALID");
  });

  it("fixture + repo together → PACK_INVALID", async () => {
    const packDir = join(dir, "both-seeds");
    mkdirSync(join(packDir, "tasks"), { recursive: true });
    mkdirSync(join(packDir, "fx"), { recursive: true });
    writeFileSync(join(packDir, "pack.json"), JSON.stringify({ name: "b" }));
    writeFileSync(
      join(packDir, "tasks", "a.json"),
      JSON.stringify({
        prompt: "x",
        fixture: "fx",
        repo: "https://example.com/unused.git",
      }),
    );
    const err = await expectPackError(loadPack(packDir), "PACK_INVALID");
    expect(err.message).toContain("fixture");
    expect(err.message).toContain("repo");
  });

  it("fixture escaping the pack dir → PACK_INVALID", async () => {
    // Community packs come from git clones — "../" must not pull host
    // files into the agent workspace.
    const packDir = join(dir, "escape");
    mkdirSync(join(packDir, "tasks"), { recursive: true });
    mkdirSync(join(dir, "outside"), { recursive: true });
    writeFileSync(join(packDir, "pack.json"), JSON.stringify({ name: "e" }));
    writeFileSync(
      join(packDir, "tasks", "a.json"),
      JSON.stringify({ prompt: "x", fixture: "../outside" }),
    );
    const err = await expectPackError(loadPack(packDir), "PACK_INVALID");
    expect(err.message).toContain("escapes");
  });

  it("fixture that is a file, not a dir → PACK_INVALID", async () => {
    const packDir = join(dir, "filefx");
    mkdirSync(join(packDir, "tasks"), { recursive: true });
    writeFileSync(join(packDir, "pack.json"), JSON.stringify({ name: "f" }));
    writeFileSync(join(packDir, "fx.txt"), "not a dir");
    writeFileSync(
      join(packDir, "tasks", "a.json"),
      JSON.stringify({ prompt: "x", fixture: "fx.txt" }),
    );
    const err = await expectPackError(loadPack(packDir), "PACK_INVALID");
    expect(err.message).toContain("does not exist");
  });
});

describe("lintPack", () => {
  it("warns on tasks without checks and on dir/name mismatch", async () => {
    const packDir = join(dir, "warn-dir");
    mkdirSync(join(packDir, "tasks"), { recursive: true });
    writeFileSync(
      join(packDir, "pack.json"),
      JSON.stringify({ name: "different-name" }),
    );
    writeFileSync(
      join(packDir, "tasks", "a.json"),
      JSON.stringify({ prompt: "x" }),
    );
    const { errors, warnings } = await lintPack(packDir);
    expect(errors).toEqual([]);
    expect(warnings.some((w) => w.includes("different-name"))).toBe(true);
    expect(warnings.some((w) => w.includes("no checks"))).toBe(true);
  });

  it("collects errors without stopping at the first", async () => {
    const packDir = join(dir, "multi-err");
    mkdirSync(join(packDir, "tasks"), { recursive: true });
    writeFileSync(join(packDir, "pack.json"), JSON.stringify({ name: "m" }));
    writeFileSync(join(packDir, "tasks", "a.json"), "{bad json");
    writeFileSync(
      join(packDir, "tasks", "b.json"),
      JSON.stringify({ prompt: "" }),
    );
    const { errors } = await lintPack(packDir);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  it("errors when a task sets both fixture and repo", async () => {
    const packDir = join(dir, "lint-both");
    mkdirSync(join(packDir, "tasks"), { recursive: true });
    mkdirSync(join(packDir, "fx"), { recursive: true });
    writeFileSync(
      join(packDir, "pack.json"),
      JSON.stringify({ name: "lint-both" }),
    );
    writeFileSync(
      join(packDir, "tasks", "a.json"),
      JSON.stringify({
        prompt: "x",
        fixture: "fx",
        repo: "https://example.com/r.git",
      }),
    );
    const { errors } = await lintPack(packDir);
    expect(errors.some((e) => e.includes("both 'fixture' and 'repo'"))).toBe(
      true,
    );
  });

  it("flags a fixture that escapes the pack dir", async () => {
    const packDir = join(dir, "lint-escape");
    mkdirSync(join(packDir, "tasks"), { recursive: true });
    writeFileSync(
      join(packDir, "pack.json"),
      JSON.stringify({ name: "lint-escape" }),
    );
    writeFileSync(
      join(packDir, "tasks", "a.json"),
      JSON.stringify({ prompt: "x", fixture: "../outside" }),
    );
    const { errors } = await lintPack(packDir);
    expect(errors.some((e) => e.includes("escapes the pack dir"))).toBe(true);
  });
});

describe("resolvePack", () => {
  it("resolves a local directory", async () => {
    const packDir = join(dir, "local-pack");
    await initPack(packDir, "local-pack");
    const pack = await resolvePack(packDir);
    expect(pack.name).toBe("local-pack");
    expect(pack.tasks.length).toBe(1);
  });

  it("resolves a bare name via packs/<name>/ in a file registry", async () => {
    const regDir = join(dir, "reg");
    const packDir = join(regDir, "packs", "community-pack");
    await initPack(packDir, "community-pack");
    const pack = await resolvePack("community-pack", { registry: regDir });
    expect(pack.name).toBe("community-pack");
    expect(pack.dir).toBe(packDir);
  });

  it("bare name without a registry → PACK_NOT_FOUND", async () => {
    await expectPackError(resolvePack("ghost-pack"), "PACK_NOT_FOUND");
  });

  it("bare name absent from the registry → PACK_NOT_FOUND", async () => {
    const regDir = join(dir, "reg-empty");
    mkdirSync(regDir, { recursive: true });
    await expectPackError(
      resolvePack("absent", { registry: regDir }),
      "PACK_NOT_FOUND",
    );
  });
});

describe("loadPack repo: cached clone refresh", () => {
  const gitEnv = {
    GIT_AUTHOR_NAME: "arena-test",
    GIT_AUTHOR_EMAIL: "arena@test.dev",
    GIT_COMMITTER_NAME: "arena-test",
    GIT_COMMITTER_EMAIL: "arena@test.dev",
  };
  const gitIn = (cwd: string, ...args: string[]) =>
    gitOrThrow([...args], { cwd, env: gitEnv });

  /** A git repo at dir/<name> with one committed file. */
  async function makeUpstream(name: string): Promise<string> {
    const upstream = join(dir, name);
    mkdirSync(upstream, { recursive: true });
    await gitIn(upstream, "init");
    writeFileSync(join(upstream, "file.txt"), "v1");
    await gitIn(upstream, "add", "-A");
    await gitIn(upstream, "commit", "-m", "v1");
    return upstream;
  }

  async function packWithRepo(name: string, repo: string): Promise<string> {
    const packDir = join(dir, name);
    mkdirSync(join(packDir, "tasks"), { recursive: true });
    writeFileSync(join(packDir, "pack.json"), JSON.stringify({ name }));
    writeFileSync(
      join(packDir, "tasks", "a.json"),
      JSON.stringify({ prompt: "p", repo }),
    );
    return packDir;
  }

  it("fast-forwards a clean cached clone", async () => {
    const repo = await makeUpstream("up-ff");
    const packDir = await packWithRepo("pack-ff", repo);
    const cacheDir = join(dir, "cache-ff");

    const first = await loadPack(packDir, { cacheDir });
    const cached = first.tasks[0]?.fixture;
    expect(cached).toBeDefined();
    expect(existsSync(join(cached!, "file.txt"))).toBe(true);

    writeFileSync(join(repo, "v2.txt"), "v2");
    await gitIn(repo, "add", "-A");
    await gitIn(repo, "commit", "-m", "v2");

    const second = await loadPack(packDir, { cacheDir });
    expect(second.tasks[0]?.fixture).toBe(cached);
    expect(existsSync(join(cached!, "v2.txt"))).toBe(true);
  });

  it("resyncs a dirty cached clone instead of silently reusing it", async () => {
    const repo = await makeUpstream("up-dirty");
    const packDir = await packWithRepo("pack-dirty", repo);
    const cacheDir = join(dir, "cache-dirty");

    const first = await loadPack(packDir, { cacheDir });
    const cached = first.tasks[0]?.fixture;
    expect(cached).toBeDefined();

    // Upstream moved on and the cache has uncommitted edits — no pull
    // can apply here. The dirty bytes must be discarded by the resync,
    // never copied into a workspace.
    writeFileSync(join(repo, "file.txt"), "v2");
    await gitIn(repo, "add", "-A");
    await gitIn(repo, "commit", "-m", "v2");
    writeFileSync(join(cached!, "file.txt"), "dirty local edit");

    const second = await loadPack(packDir, { cacheDir });
    expect(second.tasks[0]?.fixture).toBe(cached);
    expect(readFileSync(join(cached!, "file.txt"), "utf8")).toBe("v2");
  });

  it("resyncs when upstream history is rewritten (non-fast-forward)", async () => {
    const repo = await makeUpstream("up-nonff");
    const packDir = await packWithRepo("pack-nonff", repo);
    const cacheDir = join(dir, "cache-nonff");

    const first = await loadPack(packDir, { cacheDir });
    const cached = first.tasks[0]?.fixture;
    expect(cached).toBeDefined();

    // Amending upstream's only commit orphans the cached tip — no
    // fast-forward exists, so `pull --ff-only` would wedge the cache
    // forever. Resetting to @{upstream} must recover it.
    writeFileSync(join(repo, "file.txt"), "rewritten");
    await gitIn(repo, "add", "-A");
    await gitIn(repo, "commit", "--amend", "-m", "v1-rewritten");

    const second = await loadPack(packDir, { cacheDir });
    expect(second.tasks[0]?.fixture).toBe(cached);
    expect(readFileSync(join(cached!, "file.txt"), "utf8")).toBe("rewritten");
  });

  it("fails when the cached clone's upstream is gone", async () => {
    const repo = await makeUpstream("up-gone");
    const packDir = await packWithRepo("pack-gone", repo);
    const cacheDir = join(dir, "cache-gone");

    await loadPack(packDir, { cacheDir });
    rmSync(repo, { recursive: true, force: true });

    const err = await expectPackError(
      loadPack(packDir, { cacheDir }),
      "PACK_NOT_FOUND",
    );
    expect(err.message).toContain("cannot update repo clone");
  });

  it("fails when upstream deletes the tracked branch", async () => {
    // A pack clone is a FULL clone — `fetch` keeps succeeding after
    // the tracked branch is deleted upstream (other refs still exist),
    // so only --prune drops the stale origin/<branch> ref that
    // @{upstream} would otherwise keep resolving to the deleted commit.
    const src = join(dir, "up-del-src");
    mkdirSync(join(src, "tasks"), { recursive: true });
    writeFileSync(join(src, "pack.json"), JSON.stringify({ name: "del" }));
    writeFileSync(
      join(src, "tasks", "a.json"),
      JSON.stringify({ prompt: "p" }),
    );
    await gitIn(src, "init");
    await gitIn(src, "add", "-A");
    await gitIn(src, "commit", "-m", "v1");

    const bare = join(dir, "up-del.git");
    await gitIn(dir, "clone", "--bare", src, bare);
    const cacheDir = join(dir, "cache-del");

    await resolvePack(bare, { cacheDir });

    // Repoint remote HEAD so the tracked branch itself can be deleted.
    const tracked = (
      await gitIn(bare, "symbolic-ref", "--short", "HEAD")
    ).stdout.trim();
    await gitIn(bare, "branch", "moved", tracked);
    await gitIn(bare, "symbolic-ref", "HEAD", "refs/heads/moved");
    await gitIn(bare, "branch", "-D", tracked);

    const err = await expectPackError(
      resolvePack(bare, { cacheDir }),
      "PACK_NOT_FOUND",
    );
    expect(err.message).toContain("cannot reset pack clone");
  });

  it("removes nested git repositories on refresh", async () => {
    const repo = await makeUpstream("up-nested");
    const packDir = await packWithRepo("pack-nested", repo);
    const cacheDir = join(dir, "cache-nested");

    const first = await loadPack(packDir, { cacheDir });
    const cached = first.tasks[0]?.fixture;
    expect(cached).toBeDefined();

    // An untracked nested git repo survives `clean -fdx` — a single
    // -f skips dirs containing .git — and its files would leak into
    // every workspace copied from the cache.
    writeFileSync(join(repo, "v2.txt"), "v2");
    await gitIn(repo, "add", "-A");
    await gitIn(repo, "commit", "-m", "v2");
    await gitIn(cached!, "init", "nested");

    const second = await loadPack(packDir, { cacheDir });
    expect(second.tasks[0]?.fixture).toBe(cached);
    expect(existsSync(join(cached!, "nested"))).toBe(false);
  });

  it("scrubs unrelated edits and untracked files on refresh", async () => {
    const repo = await makeUpstream("up-stray");
    const packDir = await packWithRepo("pack-stray", repo);
    const cacheDir = join(dir, "cache-stray");

    const first = await loadPack(packDir, { cacheDir });
    const cached = first.tasks[0]?.fixture;
    expect(cached).toBeDefined();

    // Upstream adds a file without touching file.txt, while the cache
    // holds an unrelated local edit + a stray untracked file. Without a
    // pristine restore the runner would copy both into every workspace.
    writeFileSync(join(repo, "v2.txt"), "v2");
    await gitIn(repo, "add", "-A");
    await gitIn(repo, "commit", "-m", "v2");
    writeFileSync(join(cached!, "file.txt"), "unrelated local edit");
    writeFileSync(join(cached!, "stray.txt"), "stray");

    const second = await loadPack(packDir, { cacheDir });
    expect(second.tasks[0]?.fixture).toBe(cached);
    expect(readFileSync(join(cached!, "file.txt"), "utf8")).toBe("v1");
    expect(existsSync(join(cached!, "v2.txt"))).toBe(true);
    expect(existsSync(join(cached!, "stray.txt"))).toBe(false);
  });
});
