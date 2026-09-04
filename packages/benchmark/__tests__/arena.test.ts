import { describe, it, expect } from "vitest";
import { extractMetrics, aggregateMetrics } from "../src/arena.js";
import type { RunResult, RunMetrics } from "../src/index.js";

describe("extractMetrics", () => {
  it("maps PromptResponse usage and tool call count to RunMetrics", () => {
    const startTime = Date.now() - 5000;
    const promptResult = {
      stopReason: "end_turn" as const,
      usage: {
        totalTokens: 1000,
        inputTokens: 600,
        outputTokens: 400,
        thoughtTokens: 100,
      },
    };
    const toolCallCount = 7;

    const metrics = extractMetrics(promptResult, toolCallCount, startTime);

    expect(metrics.totalTokens).toBe(1000);
    expect(metrics.inputTokens).toBe(600);
    expect(metrics.outputTokens).toBe(400);
    expect(metrics.thoughtTokens).toBe(100);
    expect(metrics.toolCallCount).toBe(7);
    expect(metrics.stopReason).toBe("end_turn");
    expect(metrics.executionTimeMs).toBeGreaterThanOrEqual(4000);
  });

  it("handles missing usage (null or undefined)", () => {
    const startTime = Date.now() - 1000;
    const promptResult = {
      stopReason: "end_turn" as const,
      usage: null,
    };

    const metrics = extractMetrics(promptResult, 0, startTime);

    expect(metrics.totalTokens).toBe(0);
    expect(metrics.inputTokens).toBe(0);
    expect(metrics.outputTokens).toBe(0);
    expect(metrics.thoughtTokens).toBe(0);
  });

  it("handles missing thoughtTokens", () => {
    const startTime = Date.now();
    const promptResult = {
      stopReason: "end_turn" as const,
      usage: {
        totalTokens: 500,
        inputTokens: 300,
        outputTokens: 200,
      },
    };

    const metrics = extractMetrics(promptResult, 3, startTime);

    expect(metrics.thoughtTokens).toBe(0);
  });

  it("records non-end_turn stop reasons", () => {
    const startTime = Date.now();
    const promptResult = {
      stopReason: "max_tokens" as const,
      usage: null,
    };

    const metrics = extractMetrics(promptResult, 0, startTime);

    expect(metrics.stopReason).toBe("max_tokens");
  });
});

describe("aggregateMetrics", () => {
  it("averages metrics across multiple RunResults of one agent type", () => {
    const results: RunResult[] = [
      makeResult("raw-shell", true, 100, 50, 150, 5, 3000),
      makeResult("raw-shell", true, 200, 100, 300, 10, 5000),
      makeResult("raw-shell", false, 150, 75, 225, 7, 4000),
    ];

    const agg = aggregateMetrics(results, "raw-shell");

    expect(agg.totalTasks).toBe(3);
    expect(agg.successCount).toBe(2);
    expect(agg.avgInputTokens).toBe(150);
    expect(agg.avgOutputTokens).toBe(75);
    expect(agg.avgTotalTokens).toBe(225);
    expect(agg.avgToolCalls).toBeCloseTo(7.33, 1);
    expect(agg.avgExecutionTimeMs).toBeCloseTo(4000, 0);
  });

  it("handles empty results list", () => {
    const agg = aggregateMetrics([], "raw-shell");

    expect(agg.totalTasks).toBe(0);
    expect(agg.successCount).toBe(0);
    expect(agg.avgInputTokens).toBe(0);
    expect(agg.avgTotalTokens).toBe(0);
  });

  it("filters by agent type", () => {
    const results: RunResult[] = [
      makeResult("raw-shell", true, 100, 50, 150, 5, 3000),
      makeResult("sverka", true, 50, 25, 75, 2, 1000),
    ];

    const aggRaw = aggregateMetrics(results, "raw-shell");
    const aggSverka = aggregateMetrics(results, "sverka");

    expect(aggRaw.totalTasks).toBe(1);
    expect(aggRaw.avgTotalTokens).toBe(150);
    expect(aggSverka.totalTasks).toBe(1);
    expect(aggSverka.avgTotalTokens).toBe(75);
  });
});

function makeResult(
  agentType: string,
  success: boolean,
  inputTokens: number,
  outputTokens: number,
  totalTokens: number,
  toolCalls: number,
  executionTimeMs: number,
): RunResult {
  const metrics: RunMetrics = {
    inputTokens,
    outputTokens,
    thoughtTokens: 0,
    totalTokens,
    toolCallCount: toolCalls,
    executionTimeMs,
    stopReason: success ? "end_turn" : "max_tokens",
  };
  return {
    taskId: "test-task",
    agentId: agentType,
    agentType,
    metrics,
    success,
  };
}
