import { describe, it, expect } from "vitest";
import { runBenchmark, BENCHMARK_TASKS, DEFAULT_AGENTS } from "../src/index.js";

describe.skipIf(!process.env.SVERKA_BENCHMARK)("integration: real agent spawn", () => {
  it("runs one task with both agents and collects metrics", async () => {
    const result = await runBenchmark({
      tasks: [BENCHMARK_TASKS[0]!],
      agents: DEFAULT_AGENTS,
      model: process.env.DEVIN_MODEL ?? "glm-5-2",
    });

    expect(result.results).toHaveLength(2);
    expect(result.timestamp).toBeTruthy();
    expect(result.model).toBeTruthy();

    for (const run of result.results) {
      expect(run.metrics.totalTokens).toBeGreaterThanOrEqual(0);
      expect(run.metrics.toolCallCount).toBeGreaterThanOrEqual(0);
      expect(run.metrics.executionTimeMs).toBeGreaterThan(0);
      expect(run.metrics.stopReason).toBeTruthy();
    }

    expect(result.summary["raw-shell"].totalTasks).toBe(1);
    expect(result.summary.sverka.totalTasks).toBe(1);
  }, 120000);
});
