import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  traceToActions,
  traceToRunEvents,
  traceGraph,
  hasRealTimings,
  writeTraceReport,
} from "../src/trace-report.js";
import type { RunResult, TraceData, TraceStep } from "../src/types.js";

function step(
  partial: Partial<TraceStep> & Pick<TraceStep, "stepId">,
): TraceStep {
  return {
    timestamp: "2026-09-28T00:00:00.000Z",
    source: "agent",
    message: "",
    isLlmCall: false,
    ...partial,
  };
}

function trace(steps: TraceStep[]): TraceData {
  return {
    sessionId: "sess-1",
    model: "swe-2-high",
    steps,
    finalMetrics: {
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalCachedTokens: 0,
      totalSteps: steps.length,
    },
  };
}

function result(t: TraceData, overrides?: Partial<RunResult>): RunResult {
  return {
    taskId: "fix-tests",
    modelId: "swe-2-high",
    pluginIds: [],
    metrics: {
      inputTokens: 0,
      outputTokens: 0,
      thoughtTokens: 0,
      totalTokens: 0,
      toolCallCount: 0,
      llmCallCount: 0,
      executionTimeMs: 12000,
      stopReason: "end_turn",
    },
    trace: t,
    output: "",
    success: true,
    checkResults: [],
    verdicts: [],
    ...overrides,
  };
}

describe("traceToActions", () => {
  it("keeps only agent steps, collapses adjacent duplicates", () => {
    const t = trace([
      step({ stepId: 1, source: "system", message: "ctx" }),
      step({ stepId: 2, source: "user", message: "task" }),
      step({ stepId: 3, isLlmCall: true, message: "let me check tests" }),
      // collector replays the same turn twice — dedupe
      step({ stepId: 4, isLlmCall: true, message: "let me check tests" }),
      step({
        stepId: 5,
        toolCalls: [
          {
            functionName: "exec",
            arguments: { command: "bun test" },
            toolCallId: "c1",
          },
        ],
      }),
    ]);
    const actions = traceToActions(t);
    expect(actions).toHaveLength(2);
    expect(actions[0]!.kind).toBe("think");
    expect(actions[1]!.kind).toBe("tool");
    expect(actions[1]!.stepId).toContain("bun test");
  });

  it("labels tool calls with function name + key argument", () => {
    const t = trace([
      step({
        stepId: 1,
        toolCalls: [
          {
            functionName: "exec",
            arguments: { command: "npx sverka run --format sarif" },
            toolCallId: "c1",
          },
        ],
      }),
    ]);
    expect(traceToActions(t)[0]!.label).toBe(
      "exec: npx sverka run --format sarif",
    );
  });
});

describe("traceToRunEvents", () => {
  it("allocates the real total duration across steps by kind weight", () => {
    const t = trace([
      step({ stepId: 1, isLlmCall: true, message: "thinking" }),
      step({
        stepId: 2,
        toolCalls: [
          {
            functionName: "exec",
            arguments: { command: "bun test" },
            toolCallId: "c1",
          },
        ],
      }),
    ]);
    const events = traceToRunEvents(result(t));
    const succeeded = events.filter((e) => e.type === "step-succeeded");
    expect(succeeded).toHaveLength(2);
    const toolStep = succeeded[1]!;
    const thinkStep = succeeded[0]!;
    if (
      toolStep.type === "step-succeeded" &&
      thinkStep.type === "step-succeeded"
    ) {
      // tool weight 4 vs think 2 — tool bar is longer
      expect(toolStep.durationMs).toBeGreaterThan(thinkStep.durationMs);
    }
    const completed = events.at(-1);
    expect(completed?.type).toBe("run-completed");
  });

  it("stamps monotonically increasing at values", () => {
    const t = trace([
      step({ stepId: 1, isLlmCall: true, message: "a" }),
      step({ stepId: 2, isLlmCall: true, message: "b" }),
      step({ stepId: 3, isLlmCall: true, message: "c" }),
    ]);
    const ats = traceToRunEvents(result(t)).map((e) => e.at ?? -1);
    for (let i = 1; i < ats.length; i++) {
      expect(ats[i]).toBeGreaterThanOrEqual(ats[i - 1]!);
    }
  });

  it("uses real per-step durations when timestamps differ", () => {
    const t = trace([
      step({
        stepId: 1,
        isLlmCall: true,
        message: "thinking",
        timestamp: "2026-09-28T00:00:00.000Z",
      }),
      step({
        stepId: 2,
        toolCalls: [
          {
            functionName: "exec",
            arguments: { command: "bun test" },
            toolCallId: "c1",
          },
        ],
        timestamp: "2026-09-28T00:00:10.000Z",
      }),
    ]);
    const r = result(t);
    expect(hasRealTimings(r)).toBe(true);
    const succeeded = traceToRunEvents(r).filter(
      (e) => e.type === "step-succeeded",
    );
    if (
      succeeded[0]?.type === "step-succeeded" &&
      succeeded[1]?.type === "step-succeeded"
    ) {
      // 10s real gap, 12s total → think bar ~10s, tool bar ~2s
      expect(succeeded[0].durationMs).toBe(10000);
      expect(succeeded[1].durationMs).toBe(2000);
    }
  });

  it("falls back to weights when all timestamps are identical", () => {
    const t = trace([
      step({ stepId: 1, isLlmCall: true, message: "a" }),
      step({ stepId: 2, isLlmCall: true, message: "b" }),
    ]);
    expect(hasRealTimings(result(t))).toBe(false);
  });

  it("marks the run failed and fails the tail step when success is false", () => {
    const t = trace([
      step({ stepId: 1, isLlmCall: true, message: "x" }),
      step({ stepId: 2, isLlmCall: true, message: "y" }),
    ]);
    const events = traceToRunEvents(
      result(t, { success: false, error: "check failed" }),
    );
    const last = events.at(-1);
    expect(last?.type === "run-completed" && last.status).toBe("failure");
    const terminal = events.filter(
      (e) => e.type === "step-succeeded" || e.type === "step-failed",
    );
    expect(terminal[0]?.type).toBe("step-succeeded");
    const tail = terminal.at(-1);
    expect(tail?.type === "step-failed" && tail.error).toBe("check failed");
  });
});

describe("traceGraph", () => {
  it("chains steps linearly for the DAG view", () => {
    const actions = traceToActions(
      trace([
        step({ stepId: 1, isLlmCall: true, message: "a" }),
        step({ stepId: 2, isLlmCall: true, message: "b" }),
      ]),
    );
    const g = traceGraph(actions);
    const steps = g.project.pipelines[0]!.steps;
    expect(steps).toHaveLength(2);
    expect(steps[1]!.dependencies[0]).toMatchObject({
      producer: steps[0]!.id,
    });
  });
});

describe("writeTraceReport", () => {
  it("writes a self-contained HTML report with Gantt rows", () => {
    const dir = mkdtempSync(join(tmpdir(), "arena-report-"));
    const t = trace([
      step({ stepId: 1, isLlmCall: true, message: "plan the fix" }),
      step({
        stepId: 2,
        toolCalls: [
          {
            functionName: "exec",
            arguments: { command: "npx sverka run" },
            toolCallId: "c1",
          },
        ],
      }),
    ]);
    const out = join(dir, "report.html");
    writeTraceReport(result(t), out);
    const html = readFileSync(out, "utf-8");
    expect(html).toContain("gantt");
    expect(html).toContain("npx sverka run");
    expect(html).toContain("arena: fix-tests");
    expect(html).toContain("durations estimated");
    // self-contained — no external scripts
    expect(html).not.toMatch(/<script[^>]+src=/);
  });
});
