import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  arenaResultGraph,
  arenaResultToEvents,
  writeAggregateReport,
  runStepId,
} from "../src/aggregate-report.js";
import type { ArenaResult, RunResult } from "../src/types.js";

function run(overrides?: Partial<RunResult>): RunResult {
  return {
    taskId: "fix-test",
    modelId: "glm-5-2",
    pluginIds: [],
    metrics: {
      inputTokens: 42000,
      outputTokens: 1800,
      thoughtTokens: 200,
      totalTokens: 44000,
      toolCallCount: 8,
      llmCallCount: 12,
      executionTimeMs: 95000,
      stopReason: "end_turn",
    },
    output: "done",
    checkResults: [
      { checkId: "tests-pass", passed: true, output: "8 pass", exitCode: 0 },
    ],
    success: true,
    verdicts: [],
    ...overrides,
  } as RunResult;
}

function arenaResult(results: RunResult[]): ArenaResult {
  return {
    timestamp: "2026-10-01T00:00:00.000Z",
    config: {
      models: ["glm-5-2"],
      plugins: ["sverka"],
      tasks: [...new Set(results.map((r) => r.taskId))],
      repetitions: 1,
    },
    results,
    aggregates: [],
    analysis: [],
  };
}

describe("runStepId", () => {
  it("builds a stable readable id from task/model/combo/index", () => {
    const id = runStepId(run(), 0);
    expect(id).toBe("fix-test/glm-5-2/no-plugins/r1");
    expect(runStepId(run({ pluginIds: ["sverka"] }), 1)).toBe(
      "fix-test/glm-5-2/sverka/r2",
    );
  });
});

describe("arenaResultGraph", () => {
  it("creates one pipeline per task with one step per run", () => {
    const g = arenaResultGraph(
      arenaResult([
        run(),
        run({ taskId: "fix-test", pluginIds: ["sverka"] }),
        run({ taskId: "add-feature" }),
      ]),
    );
    const pipelines = g.project.pipelines;
    expect(pipelines).toHaveLength(2);
    const fixTest = pipelines.find((p) => p.id === "fix-test")!;
    expect(fixTest.steps).toHaveLength(2);
    // matrix fan-out: runs within a task are independent
    for (const s of fixTest.steps) {
      expect(s.dependencies ?? []).toHaveLength(0);
    }
  });
});

describe("arenaResultToEvents", () => {
  it("emits run + step events with real durations", () => {
    const events = arenaResultToEvents(
      arenaResult([run(), run({ success: false, pluginIds: ["sverka"] })]),
    );
    expect(events[0]!.type).toBe("run-started");
    expect(events.at(-1)!.type).toBe("run-completed");
    const succeeded = events.filter((e) => e.type === "step-succeeded");
    const failed = events.filter((e) => e.type === "step-failed");
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(succeeded[0]).toMatchObject({ durationMs: 95000 });
    expect(succeeded[0]!.stdout).toContain("44.0k tokens");
  });

  it("marks the whole run failed when any run fails", () => {
    const events = arenaResultToEvents(arenaResult([run({ success: false })]));
    expect(events.at(-1)).toMatchObject({ status: "failure" });
  });
});

describe("writeAggregateReport", () => {
  it("writes a self-contained HTML report listing every run", () => {
    const dir = mkdtempSync(join(tmpdir(), "arena-agg-"));
    const out = join(dir, "aggregate.html");
    writeAggregateReport(
      arenaResult([run(), run({ pluginIds: ["sverka"], success: false })]),
      out,
    );
    expect(existsSync(out)).toBe(true);
    const html = readFileSync(out, "utf8");
    expect(html).toContain("arena aggregate");
    expect(html).toContain("fix-test/glm-5-2/no-plugins/r1");
    expect(html).toContain("fix-test/glm-5-2/sverka/r2");
  });
});
