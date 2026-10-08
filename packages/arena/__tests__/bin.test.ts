import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, filterTasks } from "../src/bin.js";
import type { ArenaResult } from "../src/types.js";

const dir = mkdtempSync(join(tmpdir(), "arena-bin-"));

const resultsFixture: ArenaResult = {
  timestamp: "2026-09-23T00:00:00.000Z",
  config: { models: ["m1"], plugins: [], tasks: ["t1"], repetitions: 1 },
  results: [],
  aggregates: [
    {
      totalRuns: 2,
      successCount: 1,
      avgInputTokens: 100,
      avgOutputTokens: 50,
      avgTotalTokens: 150,
      avgToolCalls: 2,
      avgLlmCalls: 3,
      avgExecutionTimeMs: 1000,
      avgJudgeScore: 0,
      judgePassCount: 0,
      label: "m1",
    },
  ],
  analysis: [],
};

beforeAll(() => {
  writeFileSync(
    join(dir, "results.json"),
    JSON.stringify(resultsFixture, null, 2),
  );
  writeFileSync(
    join(dir, "arena.config.ts"),
    `export default {
      agent: "devin",
      models: [{ id: "m1", name: "M", envVar: "DEFINITELY_MISSING_ENV" }],
      tasks: [{ id: "t1", name: "T", prompt: "p" }],
      outputDir: ".arena",
    };`,
  );
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

class Capture {
  stdout = "";
  stderr = "";
}

function capture(): {
  c: Capture;
  io: { out(s: string): void; err(s: string): void };
} {
  const c = new Capture();
  return {
    c,
    io: { out: (s) => (c.stdout += s), err: (s) => (c.stderr += s) },
  };
}

describe("sverka-arena bin", () => {
  it("report prints the aggregate table", async () => {
    const { c, io } = capture();
    const code = await main(["report", join(dir, "results.json")], io);
    expect(code).toBe(0);
    expect(c.stdout).toContain("Aggregates");
    expect(c.stdout).toContain("m1");
  });

  it("report --format json re-emits the parsed result", async () => {
    const { c, io } = capture();
    const code = await main(
      ["report", join(dir, "results.json"), "--format", "json"],
      io,
    );
    expect(code).toBe(0);
    expect(JSON.parse(c.stdout).aggregates).toHaveLength(1);
  });

  it("report exits 2 on missing file", async () => {
    const { io } = capture();
    const code = await main(["report", join(dir, "nope.json")], io);
    expect(code).toBe(2);
  });

  it("doctor reports missing env vars as exit 1", async () => {
    const { c, io } = capture();
    const code = await main(
      ["doctor", "--config", join(dir, "arena.config.ts")],
      io,
    );
    expect(code).toBe(1);
    expect(c.stdout).toContain("DEFINITELY_MISSING_ENV");
  });

  it("doctor --format json emits structured checks", async () => {
    const { c, io } = capture();
    const code = await main(
      ["doctor", "--config", join(dir, "arena.config.ts"), "--format", "json"],
      io,
    );
    expect(code).toBe(1);
    const parsed = JSON.parse(c.stdout);
    expect(parsed.checks.some((x: { ok: boolean }) => !x.ok)).toBe(true);
  });

  it("unknown command exits 2", async () => {
    const { io } = capture();
    expect(await main(["bogus"], io)).toBe(2);
  });

  it("no args prints usage and exits 2", async () => {
    const { c, io } = capture();
    expect(await main([], io)).toBe(2);
    expect(c.stderr).toContain("usage");
  });

  it("unknown --option exits 2 instead of becoming positional", async () => {
    const { c, io } = capture();
    const code = await main(["doctor", "--forma", "json"], io);
    expect(code).toBe(2);
    expect(c.stderr).toContain("unknown option '--forma'");
  });

  it("flag missing its value exits 2", async () => {
    const { c, io } = capture();
    const code = await main(["run", "--out"], io);
    expect(code).toBe(2);
    expect(c.stderr).toContain("--out requires a value");
  });

  it("flag followed by another option exits 2", async () => {
    const { c, io } = capture();
    const code = await main(["run", "--out", "--format", "json"], io);
    expect(code).toBe(2);
    expect(c.stderr).toContain("--out requires a value");
  });

  it("run --task with an unknown id exits 2 before spawning", async () => {
    const { c, io } = capture();
    const code = await main(
      [
        "run",
        "--config",
        join(dir, "arena.config.ts"),
        "--task",
        "no-such-task",
      ],
      io,
    );
    expect(code).toBe(2);
    expect(c.stderr).toContain("no-such-task");
    expect(c.stderr).toContain("t1");
  });

  it("run --publish without a registry fails fast before the matrix", async () => {
    const { c, io } = capture();
    const code = await main(
      ["run", "--config", join(dir, "arena.config.ts"), "--publish"],
      io,
    );
    expect(code).toBe(2);
    expect(c.stderr).toContain("no registry");
    // The matrix never ran — no results payload was printed.
    expect(c.stdout).toBe("");
  });

  it("report/doctor reject --task instead of silently ignoring it", async () => {
    const { c, io } = capture();
    const code = await main(
      ["report", join(dir, "results.json"), "--task", "t1"],
      io,
    );
    expect(code).toBe(2);
    expect(c.stderr).toContain("--task is only supported by 'run'");
    const c2 = capture();
    const code2 = await main(["doctor", "--task", "t1"], c2.io);
    expect(code2).toBe(2);
    expect(c2.c.stderr).toContain("--task is only supported by 'run'");
  });

  it("report exits 2 on a results file with wrong shape", async () => {
    writeFileSync(join(dir, "not-results.json"), JSON.stringify({ ok: 1 }));
    const { c, io } = capture();
    const code = await main(["report", join(dir, "not-results.json")], io);
    expect(code).toBe(2);
    expect(c.stderr).toContain("not a sverka-arena results file");
  });
});

// ─── Spec 56 commands ────────────────────────────────────────────────

const V1_DOC = {
  schema: "arena.result/v1",
  runId: "run-cli-1",
  pack: "node-ci",
  agent: "devin",
  model: "m1",
  plugins: [],
  sverkaVersion: "0.0.0-test",
  startedAt: "2026-10-01T00:00:00.000Z",
  tasks: [
    {
      task: "t1",
      promptHash: "a".repeat(64),
      score: { passed: true, findings: 0 },
      metrics: { tokens: 100, durationMs: 500 },
    },
  ],
};

describe("sverka-arena publish/board/pack/reindex", () => {
  it("publish without a registry exits 2", async () => {
    const { c, io } = capture();
    const code = await main(
      ["publish", join(dir, "results.json"), "--pack", "p"],
      io,
    );
    expect(code).toBe(2);
    expect(c.stderr).toContain("no registry");
  });

  it("publish a v1 doc to a file registry lands at the canonical path", async () => {
    const regDir = join(dir, "cli-reg");
    const file = join(dir, "v1.json");
    writeFileSync(file, JSON.stringify(V1_DOC));
    const { c, io } = capture();
    const code = await main(["publish", file, "--registry", regDir], io);
    expect(code).toBe(0);
    expect(c.stdout).toContain(
      "results/node-ci/devin/2026-10-01/run-cli-1.json",
    );
    expect(
      existsSync(
        join(regDir, "results/node-ci/devin/2026-10-01/run-cli-1.json"),
      ),
    ).toBe(true);
    expect(existsSync(join(regDir, "index.json"))).toBe(true);
  });

  it("publish a matrix file without --pack exits 2", async () => {
    const { c, io } = capture();
    const code = await main(
      [
        "publish",
        join(dir, "results.json"),
        "--registry",
        join(dir, "cli-reg2"),
        "--config",
        join(dir, "no-such-config.ts"),
      ],
      io,
    );
    expect(code).toBe(2);
    expect(c.stderr).toContain("--pack");
  });

  it("publish an unreadable file exits 2", async () => {
    const { io } = capture();
    const code = await main(
      ["publish", join(dir, "ghost.json"), "--registry", join(dir, "x")],
      io,
    );
    expect(code).toBe(2);
  });

  it("board renders the no-data state for an empty registry", async () => {
    const { c, io } = capture();
    const code = await main(
      ["board", "--registry", join(dir, "empty-reg")],
      io,
    );
    expect(code).toBe(0);
    expect(c.stdout).toContain("no arena results");
  });

  it("board --format json emits cohorts over published results", async () => {
    const regDir = join(dir, "board-reg");
    const file = join(dir, "v1-board.json");
    writeFileSync(file, JSON.stringify(V1_DOC));
    await main(["publish", file, "--registry", regDir], capture().io);
    const { c, io } = capture();
    const code = await main(
      ["board", "--registry", regDir, "--format", "json"],
      io,
    );
    expect(code).toBe(0);
    const cohorts = JSON.parse(c.stdout) as {
      pack: string;
      rows: { agent: string }[];
    }[];
    expect(cohorts.length).toBe(1);
    expect(cohorts[0]!.pack).toBe("node-ci");
    expect(cohorts[0]!.rows[0]!.agent).toBe("devin");
  });

  it("board --format html writes a static leaderboard file", async () => {
    const regDir = join(dir, "board-html-reg");
    const out = join(dir, "board.html");
    const { c, io } = capture();
    const code = await main(
      ["board", "--registry", regDir, "--format", "html", "--out", out],
      io,
    );
    expect(code).toBe(0);
    expect(c.stdout).toContain("board.html");
    expect(readFileSync(out, "utf8")).toContain("Leaderboard");
  });

  it("pack init scaffolds a pack that lint accepts", async () => {
    const parent = join(dir, "pack-parent");
    mkdirSync(parent, { recursive: true });
    const { c, io } = capture();
    expect(await main(["pack", "init", "demo", "--dir", parent], io)).toBe(0);
    expect(c.stdout).toContain("demo");
    const c2 = capture();
    const lint = await main(["pack", "lint", join(parent, "demo")], c2.io);
    expect(lint).toBe(0);
    expect(c2.c.stdout).toContain("ok");
  });

  it("pack lint exits 1 on a broken pack", async () => {
    const bad = join(dir, "bad-pack");
    mkdirSync(join(bad, "tasks"), { recursive: true });
    writeFileSync(join(bad, "pack.json"), JSON.stringify({ name: "b" }));
    writeFileSync(join(bad, "tasks", "t.json"), "{broken");
    const { c, io } = capture();
    const code = await main(["pack", "lint", bad], io);
    expect(code).toBe(1);
    expect(c.stdout).toContain("error");
  });

  it("pack with an unknown subcommand exits 2", async () => {
    const { io } = capture();
    expect(await main(["pack", "frobnicate"], io)).toBe(2);
  });

  it("reindex rebuilds index.json and reports the run count", async () => {
    const regDir = join(dir, "reindex-reg");
    const file = join(dir, "v1-idx.json");
    writeFileSync(file, JSON.stringify(V1_DOC));
    await main(["publish", file, "--registry", regDir], capture().io);
    rmSync(join(regDir, "index.json"));
    const { c, io } = capture();
    const code = await main(["reindex", "--registry", regDir], io);
    expect(code).toBe(0);
    expect(c.stdout).toContain("1 run");
    expect(existsSync(join(regDir, "index.json"))).toBe(true);
  });

  it("run --pack with an unresolvable ref exits 2", async () => {
    const { io } = capture();
    const code = await main(
      [
        "run",
        "--pack",
        "no-such-pack-anywhere",
        "--config",
        join(dir, "none.ts"),
      ],
      io,
    );
    expect(code).toBe(2);
  });

  it("run --pack <dir> resolves the pack before failing on a missing config", async () => {
    const packDir = join(dir, "runnable-pack");
    mkdirSync(join(packDir, "tasks"), { recursive: true });
    writeFileSync(
      join(packDir, "pack.json"),
      JSON.stringify({
        name: "runnable-pack",
        defaults: { outputDir: join(dir, "runnable-pack-out") },
      }),
    );
    writeFileSync(
      join(packDir, "tasks", "t.json"),
      JSON.stringify({
        prompt: "noop",
        checks: [{ id: "c", command: "true" }],
      }),
    );
    const { c, io } = capture();
    // Explicit --config that does not exist fails AFTER pack resolution —
    // the "pack … N task(s)" line proves the pack loaded.
    const code = await main(
      [
        "run",
        "--pack",
        packDir,
        "--config",
        join(dir, "definitely-no-config.ts"),
      ],
      io,
    );
    expect(code).toBe(2);
    expect(c.stderr).toContain("pack 'runnable-pack': 1 task(s)");
    expect(c.stderr).toContain("cannot load arena config");
  });
});

describe("filterTasks", () => {
  const tasks = [{ id: "a" }, { id: "b" }, { id: "a" }];

  it("selects a subset and dedupes repeated ids", () => {
    const out = filterTasks(tasks, ["a"]);
    expect("tasks" in out && out.tasks).toEqual([{ id: "a" }]);
  });

  it("dedupes configured ids even without --task", () => {
    const out = filterTasks(tasks, []);
    expect("tasks" in out && out.tasks).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("reports unknown ids without touching the task list", () => {
    const out = filterTasks(tasks, ["zzz"]);
    expect("missing" in out && out.missing).toEqual(["zzz"]);
  });
});
