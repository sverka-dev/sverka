import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/bin.js";
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

  it("report exits 2 on a results file with wrong shape", async () => {
    writeFileSync(join(dir, "not-results.json"), JSON.stringify({ ok: 1 }));
    const { c, io } = capture();
    const code = await main(["report", join(dir, "not-results.json")], io);
    expect(code).toBe(2);
    expect(c.stderr).toContain("not a sverka-arena results file");
  });
});
