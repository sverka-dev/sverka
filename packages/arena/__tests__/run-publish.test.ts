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

import { main } from "../src/bin.js";

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
  });
});
