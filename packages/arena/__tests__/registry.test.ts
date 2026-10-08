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
    expectArenaError(
      () => resultPath(v1Doc({ pack: "../escape" })),
      "SCHEMA_INVALID",
    );
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
});
