import { describe, it, expect } from "vitest";
import { writeReport } from "../src/index.js";
import type { BenchmarkResult } from "../src/index.js";
import { writeFile, rm, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("writeReport", () => {
  it("writes valid JSON matching BenchmarkResult schema", async () => {
    const result: BenchmarkResult = {
      timestamp: "2026-09-04T10:00:00Z",
      model: "glm-5-2",
      results: [
        {
          taskId: "run-checks",
          agentId: "raw-shell",
          agentType: "raw-shell",
          metrics: {
            inputTokens: 100,
            outputTokens: 50,
            thoughtTokens: 0,
            totalTokens: 150,
            toolCallCount: 5,
            executionTimeMs: 3000,
            stopReason: "end_turn",
          },
          success: true,
        },
      ],
      summary: {
        "raw-shell": {
          totalTasks: 1,
          successCount: 1,
          avgInputTokens: 100,
          avgOutputTokens: 50,
          avgTotalTokens: 150,
          avgToolCalls: 5,
          avgExecutionTimeMs: 3000,
        },
        sverka: {
          totalTasks: 0,
          successCount: 0,
          avgInputTokens: 0,
          avgOutputTokens: 0,
          avgTotalTokens: 0,
          avgToolCalls: 0,
          avgExecutionTimeMs: 0,
        },
      },
    };

    const tmpDir = await mkdtemp(join(tmpdir(), "sverka-reporter-"));
    const outputPath = join(tmpDir, "benchmark-test.json");
    try {
      await writeReport(result, outputPath);
      const content = await readFile(outputPath);
      const parsed = JSON.parse(content);
      expect(parsed.timestamp).toBe("2026-09-04T10:00:00Z");
      expect(parsed.model).toBe("glm-5-2");
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0].metrics.totalTokens).toBe(150);
      expect(parsed.summary["raw-shell"].successCount).toBe(1);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

async function readFile(path: string): Promise<string> {
  const { readFile: rf } = await import("node:fs/promises");
  return rf(path, "utf-8");
}
