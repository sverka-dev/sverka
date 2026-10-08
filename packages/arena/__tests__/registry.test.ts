import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
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
import {
  arenaResultV1Schema,
  createFileRegistry,
  createGitRegistry,
  createS3Registry,
  openRegistry,
  parseArenaResultV1,
  promptHash,
  reindexRegistry,
  resultPath,
  type ArenaResultV1,
  type S3ClientLike,
} from "../src/registry.js";

const dir = mkdtempSync(join(tmpdir(), "arena-reg-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const HASH = "a".repeat(64);

function v1Doc(over: Partial<ArenaResultV1> = {}): ArenaResultV1 {
  return {
    schema: "arena.result/v1",
    runId: `run-${Math.random().toString(36).slice(2, 10)}`,
    pack: "node-ci",
    agent: "devin",
    model: "claude-sonnet-4-5",
    plugins: ["sverka"],
    sverkaVersion: "0.9.0",
    startedAt: "2026-10-01T02:00:00.000Z",
    tasks: [
      {
        task: "lint-fix",
        promptHash: HASH,
        score: { passed: true, findings: 0 },
        metrics: { tokens: 1000, toolCalls: 4, durationMs: 5000 },
      },
    ],
    ...over,
  };
}

function expectArenaError(
  fn: () => unknown,
  code: string,
): Promise<ArenaError> | ArenaError {
  try {
    const r = fn();
    if (r instanceof Promise) {
      return r.then(
        () => {
          throw new Error(`expected ArenaError(${code}), got success`);
        },
        (e: unknown) => {
          expect(e).toBeInstanceOf(ArenaError);
          expect((e as ArenaError).code).toBe(code);
          return e as ArenaError;
        },
      );
    }
    throw new Error(`expected ArenaError(${code}), got success`);
  } catch (e) {
    expect(e).toBeInstanceOf(ArenaError);
    expect((e as ArenaError).code).toBe(code);
    return e as ArenaError;
  }
}

// ─── Schema ──────────────────────────────────────────────────────────

describe("arena.result/v1 schema", () => {
  it("accepts a valid document", () => {
    expect(parseArenaResultV1(v1Doc())).toMatchObject({
      schema: "arena.result/v1",
      pack: "node-ci",
    });
    expect(arenaResultV1Schema.safeParse(v1Doc()).success).toBe(true);
  });

  it("SCHEMA_INVALID names missing sverkaVersion and model", () => {
    const doc = v1Doc() as Record<string, unknown>;
    delete doc["sverkaVersion"];
    delete doc["model"];
    const err = expectArenaError(
      () => parseArenaResultV1(doc),
      "SCHEMA_INVALID",
    ) as ArenaError;
    expect(err.message).toContain("sverkaVersion");
    expect(err.message).toContain("model");
  });

  it("rejects a bad promptHash shape", () => {
    const doc = v1Doc({
      tasks: [
        {
          task: "t",
          promptHash: "not-a-sha",
          score: { passed: true, findings: 0 },
          metrics: { durationMs: 1 },
        },
      ],
    });
    const err = expectArenaError(
      () => parseArenaResultV1(doc),
      "SCHEMA_INVALID",
    ) as ArenaError;
    expect(err.message).toContain("promptHash");
  });

  it("resultPath builds the canonical layout and guards segments", () => {
    const doc = v1Doc({ runId: "r1" });
    expect(resultPath(doc)).toBe("results/node-ci/devin/2026-10-01/r1.json");
    expect(resultPath(doc, "2026-09-30")).toBe(
      "results/node-ci/devin/2026-09-30/r1.json",
    );
    expectArenaError(
      () => resultPath(v1Doc({ pack: "../escape" })),
      "SCHEMA_INVALID",
    );
    // The date partition goes into a filesystem path — traversal is rejected.
    expectArenaError(() => resultPath(doc, "../../tmp/out"), "SCHEMA_INVALID");
    expectArenaError(() => resultPath(doc, "next-tuesday"), "SCHEMA_INVALID");
  });

  it("promptHash is sha256 of the prompt", () => {
    expect(promptHash("hello")).toMatch(/^[0-9a-f]{64}$/);
    expect(promptHash("hello")).toBe(promptHash("hello"));
    expect(promptHash("hello")).not.toBe(promptHash("hello!"));
  });
});

// ─── File registry ───────────────────────────────────────────────────

describe("file registry", () => {
  it("publish writes the canonical path and updates index.json", async () => {
    const reg = createFileRegistry(join(dir, "reg1"));
    const doc = v1Doc({ runId: "run-a1" });
    const rel = await reg.publish(doc);
    expect(rel).toBe("results/node-ci/devin/2026-10-01/run-a1.json");
    expect(existsSync(join(dir, "reg1", rel))).toBe(true);
    const index = JSON.parse(
      readFileSync(join(dir, "reg1", "index.json"), "utf8"),
    ) as { packs: Record<string, { runs: { runId: string }[] }> };
    expect(index.packs["node-ci"]!.runs.map((r) => r.runId)).toContain(
      "run-a1",
    );
  });

  it("two sequential publishes are both present (append-only)", async () => {
    const reg = createFileRegistry(join(dir, "reg2"));
    const p1 = await reg.publish(v1Doc({ runId: "run-b1" }));
    const p2 = await reg.publish(v1Doc({ runId: "run-b2" }));
    expect(existsSync(join(dir, "reg2", p1))).toBe(true);
    expect(existsSync(join(dir, "reg2", p2))).toBe(true);
    const listed = await reg.list();
    expect(listed.map((d) => d.runId).sort()).toEqual(["run-b1", "run-b2"]);
  });

  it("publishing an invalid doc writes nothing", async () => {
    const reg = createFileRegistry(join(dir, "reg3"));
    const bad = v1Doc() as Record<string, unknown>;
    delete bad["agent"];
    await expectArenaError(
      () => reg.publish(bad as ArenaResultV1),
      "SCHEMA_INVALID",
    );
    expect(existsSync(join(dir, "reg3", "results"))).toBe(false);
  });

  it("list filters by pack, agent, and since", async () => {
    const reg = createFileRegistry(join(dir, "reg4"));
    await reg.publish(
      v1Doc({ runId: "r-old", startedAt: "2026-09-01T00:00:00.000Z" }),
    );
    await reg.publish(
      v1Doc({
        runId: "r-new",
        pack: "py-ci",
        startedAt: "2026-10-01T00:00:00.000Z",
      }),
    );
    expect((await reg.list({ pack: "py-ci" })).map((d) => d.runId)).toEqual([
      "r-new",
    ]);
    expect((await reg.list({ agent: "other" })).length).toBe(0);
    expect(
      (await reg.list({ since: "2026-09-15" })).map((d) => d.runId),
    ).toEqual(["r-new"]);
  });

  it("list --since compares instants, not strings (offset-aware)", async () => {
    const reg = createFileRegistry(join(dir, "reg-since"));
    await reg.publish(
      v1Doc({ runId: "r-z", startedAt: "2026-10-01T00:00:00.000Z" }),
    );
    // since=01:00+02:00 == 2026-09-30T23:00Z — the run IS after since.
    expect(
      (await reg.list({ since: "2026-10-01T01:00:00+02:00" })).map(
        (d) => d.runId,
      ),
    ).toEqual(["r-z"]);
    // since=02:00+02:00 == 2026-10-01T00:00Z — same instant, inclusive.
    expect(
      (await reg.list({ since: "2026-10-01T02:00:00+02:00" })).map(
        (d) => d.runId,
      ),
    ).toEqual(["r-z"]);
    // since=03:00+02:00 == 2026-10-01T01:00Z — the run is before since.
    expect(
      (await reg.list({ since: "2026-10-01T03:00:00+02:00" })).length,
    ).toBe(0);
  });

  it("a pack named 'constructor' publishes and lists", async () => {
    // index.packs["constructor"] would resolve an inherited property on
    // a plain {} — lookups must be own-property only.
    const reg = createFileRegistry(join(dir, "reg-ctor"));
    await reg.publish(v1Doc({ runId: "r-ctor", pack: "constructor" }));
    expect(
      (await reg.list({ pack: "constructor" })).map((d) => d.runId),
    ).toEqual(["r-ctor"]);
    expect((await reg.list()).map((d) => d.runId)).toEqual(["r-ctor"]);
  });

  it("a malformed index.json (packs: null) is ignored, not crashed on", async () => {
    const regDir = join(dir, "reg-nullidx");
    const reg = createFileRegistry(regDir);
    await reg.publish(v1Doc({ runId: "r-ok" }));
    writeFileSync(
      join(regDir, "index.json"),
      JSON.stringify({
        schema: "arena.index/v1",
        updatedAt: "",
        packs: null,
      }),
    );
    // Corrupt index → treated as absent → falls back to the tree scan.
    expect((await reg.list()).map((d) => d.runId)).toEqual(["r-ok"]);
  });

  it("publish on a corrupt index.json rebuilds it — earlier runs kept", async () => {
    const regDir = join(dir, "reg-corrupt-idx");
    const reg = createFileRegistry(regDir);
    await reg.publish(v1Doc({ runId: "r-first" }));
    await reg.publish(v1Doc({ runId: "r-second" }));
    // Corrupt the index — a write that treated this as empty would
    // persist an index holding only the new run.
    writeFileSync(join(regDir, "index.json"), "{ not json");
    await reg.publish(v1Doc({ runId: "r-third" }));
    const index = JSON.parse(
      readFileSync(join(regDir, "index.json"), "utf8"),
    ) as { packs: Record<string, { runs: { runId: string }[] }> };
    expect(index.packs["node-ci"]!.runs.map((r) => r.runId).sort()).toEqual([
      "r-first",
      "r-second",
      "r-third",
    ]);
    expect((await reg.list()).map((d) => d.runId).sort()).toEqual([
      "r-first",
      "r-second",
      "r-third",
    ]);
  });

  it("publish on a shape-corrupt index.json (valid JSON, bad entries) rebuilds it", async () => {
    const regDir = join(dir, "reg-corrupt-shape");
    const reg = createFileRegistry(regDir);
    await reg.publish(v1Doc({ runId: "r-first" }));
    // Valid envelope, malformed pack entry — an upsert would crash on
    // runs.filter; treat as corrupt and rebuild from results/.
    writeFileSync(
      join(regDir, "index.json"),
      JSON.stringify({
        schema: "arena.index/v1",
        updatedAt: "",
        packs: { "node-ci": { runs: "corrupt" } },
      }),
    );
    await reg.publish(v1Doc({ runId: "r-second" }));
    const index = JSON.parse(
      readFileSync(join(regDir, "index.json"), "utf8"),
    ) as { packs: Record<string, { runs: { runId: string }[] }> };
    expect(index.packs["node-ci"]!.runs.map((r) => r.runId).sort()).toEqual([
      "r-first",
      "r-second",
    ]);
  });

  it("list surfaces non-ENOENT failures instead of returning empty", async () => {
    // results/ replaced by a regular file → readdir fails ENOTDIR
    // deterministically (even as root). A silent empty list here would
    // let `reindex` wipe index.json.
    const regDir = join(dir, "reg-list-err");
    mkdirSync(regDir, { recursive: true });
    writeFileSync(
      join(regDir, "index.json"),
      JSON.stringify({ schema: "arena.index/v1", updatedAt: "", packs: {} }),
    );
    writeFileSync(join(regDir, "results"), "not a dir");
    const reg = createFileRegistry(regDir);
    await expectArenaError(() => reg.list(), "REGISTRY_UNAVAILABLE");
  });

  it("list scans the results/ tree when there is no index", async () => {
    const regDir = join(dir, "reg-fixture");
    const rel = "results/p/a/2026-10-01/r1.json";
    mkdirSync(join(regDir, "results/p/a/2026-10-01"), { recursive: true });
    writeFileSync(
      join(regDir, rel),
      JSON.stringify(v1Doc({ runId: "r1", pack: "p", agent: "a" })),
    );
    const listed = await createFileRegistry(regDir).list();
    expect(listed.map((d) => d.runId)).toEqual(["r1"]);
  });

  it("reindex rebuilds index.json from the results tree", async () => {
    const regDir = join(dir, "reg5");
    const reg = createFileRegistry(regDir);
    await reg.publish(v1Doc({ runId: "r1" }));
    await reg.publish(v1Doc({ runId: "r2" }));
    rmSync(join(regDir, "index.json"));
    const { runs } = await reindexRegistry(reg);
    expect(runs).toBe(2);
    const index = JSON.parse(
      readFileSync(join(regDir, "index.json"), "utf8"),
    ) as { packs: Record<string, { runs: unknown[] }> };
    expect(index.packs["node-ci"]!.runs.length).toBe(2);
  });

  it("unwritable registry → REGISTRY_UNAVAILABLE naming the path", async () => {
    // A regular file where the registry dir should be — write fails
    // deterministically (ENOTDIR) even for root.
    const blocker = join(dir, "blocked");
    writeFileSync(blocker, "not a dir");
    const reg = createFileRegistry(join(blocker, "reg"));
    const err = (await expectArenaError(
      () => reg.publish(v1Doc()),
      "REGISTRY_UNAVAILABLE",
    )) as ArenaError;
    expect(err.message).toContain(blocker);
  });

  it("traces are written under traces/<runId>/", async () => {
    const reg = createFileRegistry(join(dir, "reg6"));
    const doc = v1Doc({ runId: "run-traced" });
    await reg.publish(doc, {
      traces: [{ name: "lint-fix.trace.jsonl", data: { steps: [] } }],
    });
    const tracePath = join(
      dir,
      "reg6",
      "traces/run-traced/lint-fix.trace.jsonl",
    );
    expect(existsSync(tracePath)).toBe(true);
    // single-line JSON — valid JSONL
    expect(readFileSync(tracePath, "utf8").trim().split("\n").length).toBe(1);
  });
});

// ─── openRegistry ref parsing ────────────────────────────────────────

describe("openRegistry", () => {
  it("resolves dir, file:// and s3:// refs", () => {
    const local = openRegistry(join(dir, "x"));
    const fileUrl = openRegistry(`file://${join(dir, "y")}`);
    expect(local).toBeDefined();
    expect(fileUrl).toBeDefined();
    const s3 = openRegistry("s3://bucket/prefix", { client: fakeS3() });
    expect(s3).toBeDefined();
  });
});

// ─── S3 registry (mock client — no AWS dependency) ──────────────────

function fakeS3(): S3ClientLike & { objects: Map<string, string> } {
  const objects = new Map<string, string>();
  return {
    objects,
    async putObject({ Key, Body }) {
      objects.set(Key, String(Body));
    },
    async getObject({ Key }) {
      const body = objects.get(Key);
      if (body === undefined) {
        const err = new Error("NoSuchKey");
        (err as { name?: string }).name = "NoSuchKey";
        throw err;
      }
      return { Body: body };
    },
    async listObjectsV2({ Prefix }) {
      return {
        Contents: [...objects.keys()]
          .filter((k) => Prefix === undefined || k.startsWith(Prefix))
          .map((Key) => ({ Key })),
      };
    },
  };
}

describe("s3 registry", () => {
  it("putObject path: publishes result + index to the bucket", async () => {
    const client = fakeS3();
    const reg = createS3Registry({ bucket: "b", prefix: "reg", client });
    const rel = await reg.publish(v1Doc({ runId: "run-s3" }));
    expect(client.objects.has(`reg/${rel}`)).toBe(true);
    expect(client.objects.has("reg/index.json")).toBe(true);
    const listed = await reg.list();
    expect(listed.map((d) => d.runId)).toEqual(["run-s3"]);
  });

  it("client failure → REGISTRY_UNAVAILABLE", async () => {
    const reg = createS3Registry({
      bucket: "b",
      client: {
        async putObject() {
          throw new Error("access denied");
        },
      },
    });
    await expectArenaError(() => reg.publish(v1Doc()), "REGISTRY_UNAVAILABLE");
  });

  it("corrupt index.json + unscannable results/ → REGISTRY_UNAVAILABLE, index untouched", async () => {
    const client = fakeS3();
    const reg = createS3Registry({ bucket: "b", prefix: "reg", client });
    await reg.publish(v1Doc({ runId: "run-a" }));
    await reg.publish(v1Doc({ runId: "run-b" }));
    client.objects.set("reg/index.json", "{ not json");
    // Reads work, the tree scan doesn't — the rebuild must fail rather
    // than overwrite the index with a single-run document.
    const dead = createS3Registry({
      bucket: "b",
      prefix: "reg",
      client: {
        putObject: client.putObject,
        getObject: client.getObject,
        async listObjectsV2() {
          throw new Error("denied");
        },
      },
    });
    await expectArenaError(
      () => dead.publish(v1Doc({ runId: "run-c" })),
      "REGISTRY_UNAVAILABLE",
    );
    expect(client.objects.get("reg/index.json")).toBe("{ not json");
  });
});

// ─── Git registry (real git in tmp dirs) ─────────────────────────────

function gitIn(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function makeBareRemote(name: string): string {
  const remote = join(dir, name);
  gitIn(dir, ["init", "--bare", "-b", "main", remote]);
  return remote;
}

describe("git registry", () => {
  it("publish clones, commits, and pushes to the remote", async () => {
    const remote = makeBareRemote("remote-ok.git");
    const reg = createGitRegistry({
      url: remote,
      dir: join(dir, "checkout-ok"),
    });
    const rel = await reg.publish(v1Doc({ runId: "run-g1" }));
    // Verify the remote really has it — fresh clone.
    const verify = join(dir, "verify-ok");
    gitIn(dir, ["clone", remote, verify]);
    expect(existsSync(join(verify, rel))).toBe(true);
    expect(existsSync(join(verify, "index.json"))).toBe(true);
  });

  it("non-fast-forward push → one rebase retry → publishes", async () => {
    const remote = makeBareRemote("remote-ff.git");
    const reg = createGitRegistry({
      url: remote,
      dir: join(dir, "checkout-ff"),
    });
    await reg.publish(v1Doc({ runId: "run-f1" }));
    // Advance the remote behind the checkout's back.
    const rival = join(dir, "rival");
    gitIn(dir, ["clone", remote, rival]);
    writeFileSync(join(rival, "other.txt"), "rival commit");
    gitIn(rival, ["add", "-A"]);
    gitIn(rival, [
      "-c",
      "user.name=rival",
      "-c",
      "user.email=r@x",
      "commit",
      "-m",
      "rival",
    ]);
    gitIn(rival, ["push", "origin", "HEAD:main"]);
    // Second publish: push rejected (non-FF) → pull --rebase → push ok.
    const rel2 = await reg.publish(v1Doc({ runId: "run-f2" }));
    const verify = join(dir, "verify-ff");
    gitIn(dir, ["clone", remote, verify]);
    expect(existsSync(join(verify, rel2))).toBe(true);
    expect(existsSync(join(verify, "other.txt"))).toBe(true);
  });

  it("pull --rebase failing before rebase → REGISTRY_UNAVAILABLE", async () => {
    // Deleting the remote after cloning makes the retry pull fail in
    // the fetch phase — no rebase is ever started, so the error must
    // be REGISTRY_UNAVAILABLE, not a phantom PUBLISH_CONFLICT.
    const remote = makeBareRemote("remote-gone.git");
    const reg = createGitRegistry({
      url: remote,
      dir: join(dir, "checkout-gone"),
    });
    await reg.publish(v1Doc({ runId: "run-g1" }));
    rmSync(remote, { recursive: true, force: true });
    await expectArenaError(
      () => reg.publish(v1Doc({ runId: "run-g2" })),
      "REGISTRY_UNAVAILABLE",
    );
  });

  it("persistent push rejection → PUBLISH_CONFLICT, local preserved", async () => {
    // A non-bare remote refuses pushes to its checked-out branch —
    // deterministic without mocking.
    const remote = join(dir, "remote-deny");
    gitIn(dir, ["init", "-b", "main", remote]);
    writeFileSync(join(remote, "seed.txt"), "seed");
    gitIn(remote, ["add", "-A"]);
    gitIn(remote, [
      "-c",
      "user.name=seed",
      "-c",
      "user.email=s@x",
      "commit",
      "-m",
      "seed",
    ]);
    const checkout = join(dir, "checkout-deny");
    const reg = createGitRegistry({ url: remote, dir: checkout });
    const err = (await expectArenaError(
      () => reg.publish(v1Doc({ runId: "run-d1" })),
      "PUBLISH_CONFLICT",
    )) as ArenaError;
    // Error names where the unpublished work survives.
    expect(err.message).toContain(checkout);
    const written = join(
      checkout,
      "results/node-ci/devin/2026-10-01/run-d1.json",
    );
    expect(existsSync(written)).toBe(true);
  });

  function seedRemote(name: string): { remote: string; seed: string } {
    const remote = makeBareRemote(name);
    const seed = join(dir, `${name}-seed`);
    gitIn(dir, ["clone", remote, seed]);
    writeFileSync(join(seed, "seed.txt"), "seed");
    gitIn(seed, ["add", "-A"]);
    gitIn(seed, [
      "-c",
      "user.name=seed",
      "-c",
      "user.email=s@x",
      "commit",
      "-m",
      "seed",
    ]);
    gitIn(seed, ["push", "origin", "HEAD:main"]);
    return { remote, seed };
  }

  it("refresh fast-forwards an existing checkout — list sees newer pushes", async () => {
    const { remote, seed } = seedRemote("remote-stale.git");
    // A checkout that predates the next push — the ensure memo never
    // saw this clone, so refresh takes the .git-exists path.
    const work = join(dir, "checkout-stale");
    gitIn(dir, ["clone", remote, work]);

    // A rival advances the remote behind the checkout's back.
    const rel = "results/node-ci/devin/2026-10-01/run-remote.json";
    mkdirSync(join(seed, "results/node-ci/devin/2026-10-01"), {
      recursive: true,
    });
    writeFileSync(
      join(seed, rel),
      JSON.stringify(v1Doc({ runId: "run-remote" })) + "\n",
    );
    gitIn(seed, ["add", "-A"]);
    gitIn(seed, [
      "-c",
      "user.name=seed",
      "-c",
      "user.email=s@x",
      "commit",
      "-m",
      "rival run",
    ]);
    gitIn(seed, ["push", "origin", "HEAD:main"]);

    // A bare fetch would update origin/main but leave the worktree at
    // the clone-time commit — the result file would be invisible here.
    const reg = createGitRegistry({ url: remote, dir: work });
    expect((await reg.list()).map((d) => d.runId)).toEqual(["run-remote"]);
  });

  it("concurrent publishers collide on index.json — the rebase regenerates it", async () => {
    const { remote } = seedRemote("remote-race.git");
    const dirA = join(dir, "race-a");
    const dirB = join(dir, "race-b");
    const regA = createGitRegistry({ url: remote, dir: dirA });
    const regB = createGitRegistry({ url: remote, dir: dirB });
    // B clones at the seed commit BEFORE A's publish lands — B's
    // publish commit then races A's index.json update.
    await regB.list();
    await regA.publish(v1Doc({ runId: "run-a" }));
    // Without index-conflict resolution the rebase cannot apply B's
    // rewritten index.json and this publish dies as PUBLISH_CONFLICT.
    const relB = await regB.publish(v1Doc({ runId: "run-b" }));

    const verify = join(dir, "verify-race");
    gitIn(dir, ["clone", remote, verify]);
    expect(
      existsSync(join(verify, "results/node-ci/devin/2026-10-01/run-a.json")),
    ).toBe(true);
    expect(existsSync(join(verify, relB))).toBe(true);
    // The merged index was regenerated from results/ — both runs there.
    const index = JSON.parse(
      readFileSync(join(verify, "index.json"), "utf8"),
    ) as { packs: Record<string, { runs: { runId: string }[] }> };
    expect(index.packs["node-ci"]!.runs.map((r) => r.runId).sort()).toEqual([
      "run-a",
      "run-b",
    ]);
  });

  it("unresolvable rebase conflict → REGISTRY_UNAVAILABLE, checkout not left mid-rebase", async () => {
    const { remote } = seedRemote("remote-conflict.git");
    const checkout = join(dir, "checkout-conflict");
    const reg = createGitRegistry({ url: remote, dir: checkout });
    await reg.publish(v1Doc({ runId: "run-x" }));

    // A rival rewrites the same result path behind our back.
    const rival = join(dir, "rival-conflict");
    gitIn(dir, ["clone", remote, rival]);
    const same = "results/node-ci/devin/2026-10-01/run-x.json";
    writeFileSync(
      join(rival, same),
      JSON.stringify(v1Doc({ runId: "run-x", model: "rival-model" })) + "\n",
    );
    gitIn(rival, ["add", "-A"]);
    gitIn(rival, [
      "-c",
      "user.name=rival",
      "-c",
      "user.email=r@x",
      "commit",
      "-m",
      "rival edit",
    ]);
    gitIn(rival, ["push", "origin", "HEAD:main"]);

    // Our rebase hits a conflict on the result file itself — not
    // auto-resolvable like index.json, so the pull fails.
    await expectArenaError(
      () => reg.publish(v1Doc({ runId: "run-x", model: "our-model" })),
      "REGISTRY_UNAVAILABLE",
    );

    // The failed rebase was aborted — no poisoned state, later git ops
    // still work, and the unpublished commit is preserved.
    expect(existsSync(join(checkout, ".git", "rebase-merge"))).toBe(false);
    expect(existsSync(join(checkout, ".git", "rebase-apply"))).toBe(false);
    gitIn(checkout, ["status", "--porcelain"]);
    expect(existsSync(join(checkout, same))).toBe(true);
  });

  it("list re-pulls a memoized checkout — later remote pushes become visible", async () => {
    const { remote, seed } = seedRemote("remote-relist.git");
    const work = join(dir, "checkout-relist");
    gitIn(dir, ["clone", remote, work]);
    const reg = createGitRegistry({ url: remote, dir: work });
    // First list populates the ensure memo (pull is a no-op here).
    expect(await reg.list()).toEqual([]);

    // A rival pushes a run AFTER the memoized ensure — without a
    // per-list refresh the memoized checkout never sees it.
    const rel = "results/node-ci/devin/2026-10-01/run-late.json";
    mkdirSync(join(seed, "results/node-ci/devin/2026-10-01"), {
      recursive: true,
    });
    writeFileSync(
      join(seed, rel),
      JSON.stringify(v1Doc({ runId: "run-late" })) + "\n",
    );
    gitIn(seed, ["add", "-A"]);
    gitIn(seed, [
      "-c",
      "user.name=seed",
      "-c",
      "user.email=s@x",
      "commit",
      "-m",
      "late run",
    ]);
    gitIn(seed, ["push", "origin", "HEAD:main"]);

    expect((await reg.list()).map((d) => d.runId)).toEqual(["run-late"]);
  });

  it("rebase resolves >8 consecutive index.json conflicts — no round cap", async () => {
    const { remote } = seedRemote("remote-many.git");
    const checkout = join(dir, "checkout-many");
    gitIn(dir, ["clone", remote, checkout]);

    // 9 unpublished commits — each adds a result file AND rewrites
    // index.json as a single line, so every replayed cherry-pick
    // conflicts on it.
    for (let i = 1; i <= 9; i++) {
      const rel = `results/node-ci/devin/2026-10-01/run-m${i}.json`;
      mkdirSync(join(checkout, "results/node-ci/devin/2026-10-01"), {
        recursive: true,
      });
      writeFileSync(
        join(checkout, rel),
        JSON.stringify(v1Doc({ runId: `run-m${i}` })) + "\n",
      );
      writeFileSync(
        join(checkout, "index.json"),
        JSON.stringify({
          schema: "arena.index/v1",
          updatedAt: `2026-10-0${i}T00:00:00.000Z`,
          packs: {
            "node-ci": {
              runs: Array.from({ length: i }, (_, k) => ({
                runId: `run-m${k + 1}`,
                agent: "devin",
                date: "2026-10-01",
                path: `results/node-ci/devin/2026-10-01/run-m${k + 1}.json`,
              })),
            },
          },
        }) + "\n",
      );
      gitIn(checkout, ["add", "-A"]);
      gitIn(checkout, [
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@x",
        "commit",
        "-m",
        `c${i}`,
      ]);
    }

    // Rival advances the remote with its own result + index.json.
    const rival = join(dir, "rival-many");
    gitIn(dir, ["clone", remote, rival]);
    mkdirSync(join(rival, "results/py-ci/rival/2026-10-01"), {
      recursive: true,
    });
    writeFileSync(
      join(rival, "results/py-ci/rival/2026-10-01/run-rv.json"),
      JSON.stringify(
        v1Doc({ runId: "run-rv", pack: "py-ci", agent: "rival" }),
      ) + "\n",
    );
    writeFileSync(
      join(rival, "index.json"),
      JSON.stringify({
        schema: "arena.index/v1",
        updatedAt: "2026-10-02T00:00:00.000Z",
        packs: {
          "py-ci": {
            runs: [
              {
                runId: "run-rv",
                agent: "rival",
                date: "2026-10-01",
                path: "results/py-ci/rival/2026-10-01/run-rv.json",
              },
            ],
          },
        },
      }) + "\n",
    );
    gitIn(rival, ["add", "-A"]);
    gitIn(rival, [
      "-c",
      "user.name=rival",
      "-c",
      "user.email=r@x",
      "commit",
      "-m",
      "rival",
    ]);
    gitIn(rival, ["push", "origin", "HEAD:main"]);

    // Publish replays 10 commits over the rival tip — every one
    // conflicts on index.json. An 8-round cap exits mid-rebase and
    // aborts an otherwise resolvable publish.
    const reg = createGitRegistry({ url: remote, dir: checkout });
    await reg.publish(v1Doc({ runId: "run-m10" }));

    expect(existsSync(join(checkout, ".git", "rebase-merge"))).toBe(false);
    expect(existsSync(join(checkout, ".git", "rebase-apply"))).toBe(false);

    const verify = join(dir, "verify-many");
    gitIn(dir, ["clone", remote, verify]);
    const index = JSON.parse(
      readFileSync(join(verify, "index.json"), "utf8"),
    ) as { packs: Record<string, { runs: { runId: string }[] }> };
    // The merged index was regenerated from the results/ tree — all
    // 10 ours + the rival's run.
    expect(index.packs["node-ci"]!.runs.length).toBe(10);
    expect(index.packs["py-ci"]!.runs.map((r) => r.runId)).toEqual(["run-rv"]);
    expect(
      existsSync(join(verify, "results/node-ci/devin/2026-10-01/run-m10.json")),
    ).toBe(true);
  });
});
