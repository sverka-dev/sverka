import { describe, it, expect, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ArenaResult } from "../src/types.js";

const dir = mkdtempSync(join(tmpdir(), "arena-run-pub-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/**
 * runArena spawns real agent processes — stubbed so the test reaches the
 * post-matrix publish path. Like the real runner it still writes
 * outputDir/results.json before returning.
 */
vi.mock("../src/runner.js", () => ({
  runArena: vi.fn(
    async (config: { outputDir: string }): Promise<ArenaResult> => {
      const result: ArenaResult = {
        timestamp: "2026-10-02T00:00:00.000Z",
        config: {
          models: ["m1"],
          plugins: [],
          tasks: ["t1"],
          repetitions: 1,
        },
        results: [
          {
            taskId: "t1",
            modelId: "m1",
            pluginIds: [],
            metrics: {
              inputTokens: 0,
              outputTokens: 0,
              thoughtTokens: 0,
              totalTokens: 0,
              toolCallCount: 0,
              llmCallCount: 0,
              executionTimeMs: 0,
              stopReason: "done",
            },
            trace: {
              sessionId: "s",
              model: "m1",
              steps: [],
              finalMetrics: {
                totalPromptTokens: 0,
                totalCompletionTokens: 0,
                totalCachedTokens: 0,
                totalSteps: 0,
              },
            },
            output: "out",
            success: true,
            checkResults: [],
            verdicts: [],
          },
        ],
        aggregates: [],
        analysis: [],
      };
      await mkdir(config.outputDir, { recursive: true });
      await writeFile(
        join(config.outputDir, "results.json"),
        JSON.stringify(result),
        "utf8",
      );
      return result;
    },
  ),
}));

import { main, publishRetryHint, redactRegistryRef } from "../src/bin.js";

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

describe("run --publish failure path", () => {
  it("prints the saved results.json path so publish can be retried", async () => {
    writeFileSync(
      join(dir, "arena.config.ts"),
      `export default {
        agent: "devin",
        models: [{ id: "m1", name: "M" }],
        tasks: [{ id: "t1", name: "T", prompt: "p1" }],
        outputDir: ".arena",
      };`,
    );
    const outDir = join(dir, "out");
    // A registry ref that resolves to a plain file: openRegistry succeeds
    // lazily, then every tree write fails with ENOTDIR — publish fails
    // AFTER the (stubbed) matrix ran.
    const notADir = join(dir, "not-a-dir");
    writeFileSync(notADir, "occupied");

    const { c, io } = capture();
    const code = await main(
      [
        "run",
        "--config",
        join(dir, "arena.config.ts"),
        "--out",
        outDir,
        "--format",
        "json",
        "--publish",
        "--registry",
        notADir,
      ],
      io,
    );

    expect(code).toBe(3);
    const saved = join(outDir, "results.json");
    expect(c.stderr).toContain(`results saved at ${saved}`);
    expect(c.stderr).toContain(`sverka-arena publish '${saved}'`);
    expect(c.stderr).toContain(`--registry '${notADir}'`);
    // The retry must reproduce the run's publish context: the agent id and
    // config path resolve the matrix agent + prompts, and the pinned
    // version keeps the retried run in its original comparison cohort.
    expect(c.stderr).toContain(`--agent 'devin'`);
    expect(c.stderr).toContain(`--config '${join(dir, "arena.config.ts")}'`);
    expect(c.stderr).toContain(`--sverka-version '`);
  });

  it("omits --registry from the retry hint when the ref comes from ARENA_REGISTRY", async () => {
    const outDir = join(dir, "out-env");
    const notADir = join(dir, "not-a-dir-env");
    writeFileSync(notADir, "occupied");
    process.env["ARENA_REGISTRY"] = notADir;
    try {
      const { c, io } = capture();
      const code = await main(
        [
          "run",
          "--config",
          join(dir, "arena.config.ts"),
          "--out",
          outDir,
          "--format",
          "json",
          "--publish",
        ],
        io,
      );
      expect(code).toBe(3);
      // The env ref is inherited on retry — echoing it could leak
      // credentials embedded in the ref.
      expect(c.stderr).toContain("retry with:");
      expect(c.stderr).not.toContain("--registry");
    } finally {
      delete process.env["ARENA_REGISTRY"];
    }
  });

  it("shell-quotes the saved path when --out contains an apostrophe", async () => {
    const outDir = join(dir, "o'clock");
    const notADir = join(dir, "not-a-dir-quoted");
    writeFileSync(notADir, "occupied");
    const { c, io } = capture();
    const code = await main(
      [
        "run",
        "--config",
        join(dir, "arena.config.ts"),
        "--out",
        outDir,
        "--format",
        "json",
        "--publish",
        "--registry",
        notADir,
      ],
      io,
    );
    expect(code).toBe(3);
    // `'…'` with `'\''` per embedded quote — the line survives copy-paste.
    expect(c.stderr).toContain(
      `sverka-arena publish '${join(outDir, "results.json").replace(/'/g, `'\\''`)}'`,
    );
  });
});

describe("publishRetryHint", () => {
  const base = {
    saved: "/tmp/r.json",
    pack: "p",
    agent: "a",
    sverkaVersion: "1.0.0",
  };

  it("omits a credential-bearing registry ref and points at ARENA_REGISTRY", () => {
    const [u, p] = ["user", "s3cr3t"];
    const hint = publishRetryHint({
      ...base,
      registry: `https://${u}:${p}@example.com/reg`,
    });
    expect(hint).not.toContain("--registry");
    expect(hint).not.toContain(u);
    expect(hint).not.toContain(p);
    expect(hint).toContain("ARENA_REGISTRY");
  });

  it("keeps a credential-free --registry ref", () => {
    expect(publishRetryHint({ ...base, registry: "/var/reg" })).toContain(
      "--registry '/var/reg'",
    );
  });

  it("omits --registry entirely when no ref was passed", () => {
    expect(publishRetryHint(base)).not.toContain("--registry");
  });
});

describe("redactRegistryRef", () => {
  it("strips embedded credentials from URL-like refs", () => {
    // Built at runtime — a literal user:pass@host trips secretlint's
    // BasicAuth rule even as a test fixture.
    const [u, p] = ["user", "s3cr3t"];
    expect(redactRegistryRef(`https://${u}:${p}@example.com/reg`)).toBe(
      "https://***@example.com/reg",
    );
    expect(redactRegistryRef(`git::https://${u}:${p}@host/r.git`)).toBe(
      "git::https://***@host/r.git",
    );
  });
  it("leaves credential-free refs untouched", () => {
    expect(redactRegistryRef("/var/reg")).toBe("/var/reg");
    expect(redactRegistryRef("s3://bucket/prefix")).toBe("s3://bucket/prefix");
    expect(redactRegistryRef("file:///var/reg")).toBe("file:///var/reg");
  });
});
