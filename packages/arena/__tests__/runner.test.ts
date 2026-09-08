import { describe, it, expect, vi } from "vitest";
import { pluginCombinations, aggregateResults, computeAnalysis } from "../src/runner.js";
import type {
  PluginConfig,
  RunResult,
  RunMetrics,
  TraceData,
  ArenaConfig,
  AgentAdapter,
  AgentProcess,
  ModelConfig,
  Task,
  JudgeVerdict,
  JudgeConfig,
} from "../src/types.js";
import { runArena } from "../src/runner.js";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock installPlugins to avoid copying real files in tests.
vi.mock("../src/adapters/devin.js", () => ({
  installPlugins: vi.fn().mockResolvedValue(undefined),
}));

// ─── Fixtures ────────────────────────────────────────────────────────

const plugin = (id: string): PluginConfig => ({
  id,
  name: id,
  path: `/tmp/skills/${id}`,
  enabled: true,
});

const metrics = (over: Partial<RunMetrics> = {}): RunMetrics => ({
  inputTokens: 100,
  outputTokens: 50,
  thoughtTokens: 10,
  totalTokens: 160,
  toolCallCount: 2,
  llmCallCount: 3,
  executionTimeMs: 5000,
  stopReason: "end_turn",
  ...over,
});

const trace = (): TraceData => ({
  sessionId: "s1",
  model: "glm-5-2",
  steps: [],
  finalMetrics: {
    totalPromptTokens: 100,
    totalCompletionTokens: 50,
    totalCachedTokens: 10,
    totalSteps: 1,
  },
});

const runResult = (over: Partial<RunResult> = {}): RunResult => ({
  taskId: "t1",
  modelId: "glm-5-2",
  pluginIds: [],
  metrics: metrics(),
  trace: trace(),
  output: "mock output",
  checkResults: [],
  verdicts: [],
  success: true,
  ...over,
});

const verdict = (over: Partial<JudgeVerdict> = {}): JudgeVerdict => ({
  runIndex: 0,
  score: 80,
  passed: true,
  reasoning: "good",
  issues: [],
  taskId: "t1",
  modelId: "glm-5-2",
  pluginIds: [],
  ...over,
});

// ─── pluginCombinations ──────────────────────────────────────────────

describe("pluginCombinations", () => {
  it("returns a single empty combination for zero plugins", () => {
    const combos = pluginCombinations([]);
    expect(combos).toEqual([[]]);
  });

  it("generates 2 combinations for 1 plugin (off, on)", () => {
    const combos = pluginCombinations([plugin("a")]);
    expect(combos).toHaveLength(2);
    expect(combos[0]?.[0]?.enabled).toBe(false);
    expect(combos[1]?.[0]?.enabled).toBe(true);
  });

  it("generates 4 combinations for 2 plugins", () => {
    const combos = pluginCombinations([plugin("a"), plugin("b")]);
    expect(combos).toHaveLength(4);
    // Each combo has both plugins
    for (const combo of combos) {
      expect(combo).toHaveLength(2);
    }
    // Verify all on/off patterns are present
    const patterns = combos.map((c) =>
      c.map((p) => (p.enabled ? "1" : "0")).join(""),
    );
    expect(patterns.sort()).toEqual(["00", "01", "10", "11"]);
  });

  it("generates 8 combinations for 3 plugins", () => {
    const combos = pluginCombinations([
      plugin("a"),
      plugin("b"),
      plugin("c"),
    ]);
    expect(combos).toHaveLength(8);
  });

  it("preserves plugin metadata in each combination", () => {
    const p: PluginConfig = {
      id: "sverka",
      name: "Sverka",
      path: "/skills/sverka",
      enabled: true,
    };
    const combos = pluginCombinations([p]);
    for (const combo of combos) {
      const entry = combo[0];
      expect(entry?.id).toBe("sverka");
      expect(entry?.name).toBe("Sverka");
      expect(entry?.path).toBe("/skills/sverka");
    }
  });

  it("does not mutate the input plugin array", () => {
    const plugins = [plugin("a")];
    const original = plugins[0]?.enabled;
    pluginCombinations(plugins);
    expect(plugins[0]?.enabled).toBe(original);
  });
});

// ─── aggregateResults ────────────────────────────────────────────────

describe("aggregateResults", () => {
  it("returns zeroed metrics for no matching results", () => {
    const agg = aggregateResults([], () => true);
    expect(agg).toEqual({
      totalRuns: 0,
      successCount: 0,
      avgInputTokens: 0,
      avgOutputTokens: 0,
      avgTotalTokens: 0,
      avgToolCalls: 0,
      avgLlmCalls: 0,
      avgExecutionTimeMs: 0,
      avgJudgeScore: 0,
      judgePassCount: 0,
      label: "",
    });
  });

  it("computes averages for matching results", () => {
    const results = [
      runResult({ metrics: metrics({ inputTokens: 100, outputTokens: 50, totalTokens: 160, toolCallCount: 2, llmCallCount: 3, executionTimeMs: 4000 }), success: true }),
      runResult({ metrics: metrics({ inputTokens: 200, outputTokens: 100, totalTokens: 320, toolCallCount: 4, llmCallCount: 6, executionTimeMs: 6000 }), success: false }),
    ];
    const agg = aggregateResults(results, () => true);
    expect(agg.totalRuns).toBe(2);
    expect(agg.successCount).toBe(1);
    expect(agg.avgInputTokens).toBe(150);
    expect(agg.avgOutputTokens).toBe(75);
    expect(agg.avgTotalTokens).toBe(240);
    expect(agg.avgToolCalls).toBe(3);
    expect(agg.avgLlmCalls).toBe(4.5);
    expect(agg.avgExecutionTimeMs).toBe(5000);
  });

  it("filters results by the predicate", () => {
    const results = [
      runResult({ modelId: "a", metrics: metrics({ inputTokens: 100 }) }),
      runResult({ modelId: "b", metrics: metrics({ inputTokens: 200 }) }),
      runResult({ modelId: "a", metrics: metrics({ inputTokens: 300 }) }),
    ];
    const agg = aggregateResults(results, (r) => r.modelId === "a");
    expect(agg.totalRuns).toBe(2);
    expect(agg.avgInputTokens).toBe(200);
  });

  it("rounds tool/llm averages to 2 decimals", () => {
    const results = [
      runResult({ metrics: metrics({ toolCallCount: 1, llmCallCount: 1 }) }),
      runResult({ metrics: metrics({ toolCallCount: 2, llmCallCount: 2 }) }),
      runResult({ metrics: metrics({ toolCallCount: 1, llmCallCount: 1 }) }),
    ];
    const agg = aggregateResults(results, () => true);
    expect(agg.avgToolCalls).toBe(1.33);
    expect(agg.avgLlmCalls).toBe(1.33);
  });

  it("computes avgJudgeScore and judgePassCount from verdicts", () => {
    const results = [
      runResult({ verdicts: [verdict({ score: 80, passed: true })] }),
      runResult({ verdicts: [verdict({ score: 60, passed: false })] }),
      runResult({ verdicts: [] }), // no verdict — excluded from avg
    ];
    const agg = aggregateResults(results, () => true);
    expect(agg.totalRuns).toBe(3);
    expect(agg.avgJudgeScore).toBe(70); // (80 + 60) / 2
    expect(agg.judgePassCount).toBe(1); // only first run passed
  });

  it("returns 0 avgJudgeScore when no runs have verdicts", () => {
    const results = [
      runResult({ verdicts: [] }),
      runResult({ verdicts: [] }),
    ];
    const agg = aggregateResults(results, () => true);
    expect(agg.avgJudgeScore).toBe(0);
    expect(agg.judgePassCount).toBe(0);
  });

  it("includes the label in the result", () => {
    const agg = aggregateResults([runResult()], () => true, "glm-5-2/plugins=a");
    expect(agg.label).toBe("glm-5-2/plugins=a");
  });
});

// ─── runArena (integration with mock adapter) ────────────────────────

describe("runArena", () => {
  it("runs the full matrix and writes results.json", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "arena-test-"));

    // Mock adapter that returns a deterministic result per cell.
    const mockAdapter: AgentAdapter = {
      id: "mock",
      spawn: (): AgentProcess => ({
        run: async (_prompt, _timeout) =>
          runResult({
            metrics: metrics({ inputTokens: 100, totalTokens: 160 }),
            trace: trace(),
            success: true,
          }),
        kill: () => {},
      }),
    };

    const model: ModelConfig = { id: "glm-5-2", name: "GLM" };
    const task: Task = { id: "t1", name: "Task 1", prompt: "do it" };
    const config: ArenaConfig = {
      tasks: [task],
      agent: mockAdapter,
      models: [model],
      plugins: [plugin("a")],
      repetitions: 2,
      outputDir: outDir,
    };

    const result = await runArena(config);

    // 1 task × 1 model × 2 combos × 2 reps = 4 runs
    expect(result.results).toHaveLength(4);
    expect(result.config.models).toEqual(["glm-5-2"]);
    expect(result.config.plugins).toEqual(["a"]);
    expect(result.config.tasks).toEqual(["t1"]);
    expect(result.config.repetitions).toBe(2);

    // Aggregates: one per (model × combo) = 1 × 2 = 2
    expect(result.aggregates).toHaveLength(2);

    // results.json was written
    const written = JSON.parse(
      await readFile(join(outDir, "results.json"), "utf-8"),
    ) as ArenaResult;
    expect(written.results).toHaveLength(4);

    await rm(outDir, { recursive: true, force: true });
  });

  it("handles zero plugins as a single combination", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "arena-test-"));
    const mockAdapter: AgentAdapter = {
      id: "mock",
      spawn: (): AgentProcess => ({
        run: async () => runResult({ pluginIds: [] }),
        kill: () => {},
      }),
    };
    const config: ArenaConfig = {
      tasks: [{ id: "t1", name: "T", prompt: "p" }],
      agent: mockAdapter,
      models: [{ id: "m1", name: "M" }],
      plugins: [],
      repetitions: 1,
      outputDir: outDir,
    };
    const result = await runArena(config);
    expect(result.results).toHaveLength(1);
    expect(result.aggregates).toHaveLength(1);
    await rm(outDir, { recursive: true, force: true });
  });

  it("kills the agent process after each run", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "arena-test-"));
    let killed = 0;
    const mockAdapter: AgentAdapter = {
      id: "mock",
      spawn: (): AgentProcess => ({
        run: async () => runResult(),
        kill: () => { killed++; },
      }),
    };
    const config: ArenaConfig = {
      tasks: [{ id: "t1", name: "T", prompt: "p" }],
      agent: mockAdapter,
      models: [{ id: "m1", name: "M" }],
      plugins: [plugin("a")],
      repetitions: 1,
      outputDir: outDir,
    };
    await runArena(config);
    // 1 task × 1 model × 2 combos = 2 kills
    expect(killed).toBe(2);
    await rm(outDir, { recursive: true, force: true });
  });

  it("captures errors from failed runs", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "arena-test-"));
    const mockAdapter: AgentAdapter = {
      id: "mock",
      spawn: (): AgentProcess => ({
        run: async () => { throw new Error("boom"); },
        kill: () => {},
      }),
    };
    const config: ArenaConfig = {
      tasks: [{ id: "t1", name: "T", prompt: "p" }],
      agent: mockAdapter,
      models: [{ id: "m1", name: "M" }],
      plugins: [],
      repetitions: 1,
      outputDir: outDir,
    };
    const result = await runArena(config);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.success).toBe(false);
    expect(result.results[0]?.error).toBe("boom");
    await rm(outDir, { recursive: true, force: true });
  });
});

// ─── computeAnalysis ─────────────────────────────────────────────────

describe("computeAnalysis", () => {
  it("returns empty comparisons when only baseline runs exist", () => {
    const tasks: Task[] = [{ id: "t1", name: "Task 1", prompt: "do it" }];
    const results = [
      runResult({ taskId: "t1", pluginIds: [] }),
    ];
    const analysis = computeAnalysis(results, tasks);
    expect(analysis).toHaveLength(1);
    expect(analysis[0]?.taskId).toBe("t1");
    expect(analysis[0]?.taskName).toBe("Task 1");
    expect(analysis[0]?.comparisons).toEqual([]);
  });

  it("compares baseline vs candidate combo", () => {
    const tasks: Task[] = [{ id: "t1", name: "Task 1", prompt: "do it" }];
    const results = [
      runResult({ taskId: "t1", pluginIds: [], metrics: metrics({ totalTokens: 200, executionTimeMs: 5000 }) }),
      runResult({ taskId: "t1", pluginIds: ["sverka"], metrics: metrics({ totalTokens: 100, executionTimeMs: 3000 }) }),
    ];
    const analysis = computeAnalysis(results, tasks);
    expect(analysis).toHaveLength(1);
    expect(analysis[0]?.comparisons).toHaveLength(1);

    const cmp = analysis[0]?.comparisons[0];
    expect(cmp?.baseline).toBe("no-plugins");
    expect(cmp?.candidate).toBe("sverka");
    expect(cmp?.deltaTokens).toBe(-100); // 100 - 200
    expect(cmp?.deltaTimeMs).toBe(-2000); // 3000 - 5000
  });

  it("computes deltaJudgeScore when verdicts present", () => {
    const tasks: Task[] = [{ id: "t1", name: "T", prompt: "p" }];
    const results = [
      runResult({
        taskId: "t1",
        pluginIds: [],
        verdicts: [verdict({ score: 60, passed: false })],
      }),
      runResult({
        taskId: "t1",
        pluginIds: ["sverka"],
        verdicts: [verdict({ score: 90, passed: true })],
      }),
    ];
    const analysis = computeAnalysis(results, tasks);
    const cmp = analysis[0]?.comparisons[0];
    expect(cmp?.deltaJudgeScore).toBe(30); // 90 - 60
    expect(cmp?.candidateBetter).toBe(true);
  });

  it("handles multiple tasks independently", () => {
    const tasks: Task[] = [
      { id: "t1", name: "T1", prompt: "p1" },
      { id: "t2", name: "T2", prompt: "p2" },
    ];
    const results = [
      runResult({ taskId: "t1", pluginIds: [] }),
      runResult({ taskId: "t1", pluginIds: ["a"] }),
      runResult({ taskId: "t2", pluginIds: [] }),
      runResult({ taskId: "t2", pluginIds: ["b"] }),
    ];
    const analysis = computeAnalysis(results, tasks);
    expect(analysis).toHaveLength(2);
    expect(analysis[0]?.taskId).toBe("t1");
    expect(analysis[0]?.comparisons[0]?.candidate).toBe("a");
    expect(analysis[1]?.taskId).toBe("t2");
    expect(analysis[1]?.comparisons[0]?.candidate).toBe("b");
  });

  it("returns empty array for tasks with no runs", () => {
    const tasks: Task[] = [{ id: "t1", name: "T", prompt: "p" }];
    const analysis = computeAnalysis([], tasks);
    expect(analysis).toHaveLength(1);
    expect(analysis[0]?.comparisons).toEqual([]);
  });
});

// ─── runArena with judge ─────────────────────────────────────────────

describe("runArena with judge", () => {
  it("runs the judge when configured and sets judgeModel", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "arena-test-"));

    const judgeRun = vi.fn(async (_prompt: string, _timeout: number) =>
      runResult({
        output: '{"score": 85, "passed": true, "reasoning": "good work", "issues": ["none"]}',
        success: true,
      }),
    );
    const judgeKill = vi.fn();

    const mockAdapter: AgentAdapter = {
      id: "mock",
      spawn: (): AgentProcess => ({
        run: async () => runResult({ output: "agent output", success: true }),
        kill: () => {},
      }),
    };
    const mockJudgeAdapter: AgentAdapter = {
      id: "mock-judge",
      spawn: (): AgentProcess => ({
        run: judgeRun,
        kill: judgeKill,
      }),
    };

    const judge: JudgeConfig = {
      model: { id: "judge-model", name: "Judge" },
      agent: mockJudgeAdapter,
    };

    const config: ArenaConfig = {
      tasks: [{ id: "t1", name: "T", prompt: "do it", successCriteria: "works" }],
      agent: mockAdapter,
      models: [{ id: "m1", name: "M" }],
      plugins: [],
      repetitions: 1,
      outputDir: outDir,
      judge,
    };

    const result = await runArena(config);

    // Judge was called once per run (1 run total)
    expect(judgeRun).toHaveBeenCalledTimes(1);
    expect(judgeKill).toHaveBeenCalledTimes(1);

    // judgeModel is set in config
    expect(result.config.judgeModel).toBe("judge-model");

    // The run has a verdict
    expect(result.results[0]?.verdicts).toHaveLength(1);
    expect(result.results[0]?.verdicts[0]?.score).toBe(85);
    expect(result.results[0]?.verdicts[0]?.passed).toBe(true);

    // Analysis is computed
    expect(result.analysis).toHaveLength(1);

    await rm(outDir, { recursive: true, force: true });
  });

  it("does not run the judge when not configured", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "arena-test-"));
    const mockAdapter: AgentAdapter = {
      id: "mock",
      spawn: (): AgentProcess => ({
        run: async () => runResult({ success: true }),
        kill: () => {},
      }),
    };
    const config: ArenaConfig = {
      tasks: [{ id: "t1", name: "T", prompt: "p" }],
      agent: mockAdapter,
      models: [{ id: "m1", name: "M" }],
      plugins: [],
      repetitions: 1,
      outputDir: outDir,
    };
    const result = await runArena(config);
    expect(result.config.judgeModel).toBeUndefined();
    expect(result.results[0]?.verdicts).toEqual([]);
    await rm(outDir, { recursive: true, force: true });
  });
});
