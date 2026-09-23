import { describe, it, expect } from "vitest";
import { renderReport } from "../src/report.js";
import type { ArenaResult } from "../src/types.js";

const fixture: ArenaResult = {
  timestamp: "2026-09-23T00:00:00.000Z",
  config: {
    models: ["m1"],
    plugins: ["sverka"],
    tasks: ["t1"],
    repetitions: 1,
  },
  results: [],
  aggregates: [
    {
      totalRuns: 1,
      successCount: 1,
      avgInputTokens: 1000,
      avgOutputTokens: 500,
      avgTotalTokens: 1500,
      avgToolCalls: 3,
      avgLlmCalls: 4,
      avgExecutionTimeMs: 12000,
      avgJudgeScore: 90,
      judgePassCount: 1,
      label: "m1/sverka=on",
    },
    {
      totalRuns: 1,
      successCount: 0,
      avgInputTokens: 2000,
      avgOutputTokens: 800,
      avgTotalTokens: 2800,
      avgToolCalls: 7,
      avgLlmCalls: 9,
      avgExecutionTimeMs: 20000,
      avgJudgeScore: 40,
      judgePassCount: 0,
      label: "m1/sverka=off",
    },
  ],
  analysis: [
    {
      taskId: "t1",
      taskName: "Task 1",
      prompt: "do it",
      comparisons: [
        {
          baseline: "m1/sverka=off",
          candidate: "m1/sverka=on",
          deltaTokens: -1300,
          deltaToolCalls: -4,
          deltaLlmCalls: -5,
          deltaTimeMs: -8000,
          deltaJudgeScore: 50,
          candidateBetter: true,
        },
      ],
      summary: "Plugin reduces cost",
    },
  ],
};

describe("renderReport", () => {
  it("renders an aggregate table with one row per label", () => {
    const text = renderReport(fixture);
    expect(text).toContain("m1/sverka=on");
    expect(text).toContain("m1/sverka=off");
    expect(text).toContain("Aggregates");
  });

  it("renders per-task analysis with deltas", () => {
    const text = renderReport(fixture);
    expect(text).toContain("Task 1");
    expect(text).toContain("Plugin reduces cost");
  });

  it("handles empty aggregates/analysis", () => {
    const text = renderReport({ ...fixture, aggregates: [], analysis: [] });
    expect(text).toContain("Aggregates");
  });
});
