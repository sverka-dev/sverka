import { describe, it, expect } from "vitest";
import {
  DEFAULT_JUDGE_PROMPT,
  buildJudgePrompt,
  parseJudgeResponse,
  judgeRun,
  judgeAllRuns,
  compareCombos,
} from "../src/judge.js";
import type {
  JudgeConfig,
  RunResult,
  RunMetrics,
  TraceData,
  Task,
  AgentAdapter,
  AgentProcess,
  ModelConfig,
  JudgeVerdict,
} from "../src/types.js";

// ─── Fixtures ────────────────────────────────────────────────────────

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
  output: "I solved the task by editing the file.",
  success: true,
  verdicts: [],
  ...over,
});

const verdict = (over: Partial<JudgeVerdict> = {}): JudgeVerdict => ({
  runIndex: 0,
  score: 80,
  passed: true,
  reasoning: "Good response",
  issues: [],
  taskId: "t1",
  modelId: "glm-5-2",
  pluginIds: [],
  ...over,
});

const task = (): Task => ({
  id: "t1",
  name: "Task 1",
  prompt: "Fix the bug in src/foo.ts",
  successCriteria: "The bug is fixed and tests pass",
});

const judgeModel: ModelConfig = { id: "glm-5-2", name: "GLM" };

const judgeConfig = (over: Partial<JudgeConfig> = {}): JudgeConfig => {
  const agent: AgentAdapter = {
    id: "mock-judge",
    spawn: (): AgentProcess => ({
      run: async () => runResult({ output: '{"score": 90, "passed": true, "reasoning": "ok", "issues": []}' }),
      kill: () => {},
    }),
  };
  return { model: judgeModel, agent, ...over };
};

// ─── DEFAULT_JUDGE_PROMPT ────────────────────────────────────────────

describe("DEFAULT_JUDGE_PROMPT", () => {
  it("mentions scoring 0-100 and JSON output", () => {
    expect(DEFAULT_JUDGE_PROMPT).toContain("0-100");
    expect(DEFAULT_JUDGE_PROMPT).toContain("JSON");
    expect(DEFAULT_JUDGE_PROMPT).toContain("score");
    expect(DEFAULT_JUDGE_PROMPT).toContain("passed");
  });
});

// ─── buildJudgePrompt ────────────────────────────────────────────────

describe("buildJudgePrompt", () => {
  it("includes the task prompt", () => {
    const t = task();
    const prompt = buildJudgePrompt(t, "agent output", judgeConfig());
    expect(prompt).toContain(t.prompt);
  });

  it("includes the success criteria when present", () => {
    const t = task();
    const prompt = buildJudgePrompt(t, "agent output", judgeConfig());
    expect(prompt).toContain(t.successCriteria!);
  });

  it("includes the agent output", () => {
    const prompt = buildJudgePrompt(task(), "THE_AGENT_RESPONSE", judgeConfig());
    expect(prompt).toContain("THE_AGENT_RESPONSE");
  });

  it("does NOT include plugin info by default (blind)", () => {
    const run = runResult({ pluginIds: ["sverka"] });
    const prompt = buildJudgePrompt(task(), run.output, judgeConfig());
    expect(prompt).not.toContain("sverka");
    expect(prompt).not.toMatch(/plugins active/i);
  });

  it("reveals plugin info when config.revealPlugins is true", () => {
    const run = runResult({ pluginIds: ["sverka"], output: "out" });
    const prompt = buildJudgePrompt(
      task(),
      run.output,
      judgeConfig({ revealPlugins: true }),
    );
    // When revealed, the prompt mentions plugins.
    expect(prompt).toMatch(/plugins active/i);
  });

  it("asks for a JSON response with score, passed, reasoning, issues", () => {
    const prompt = buildJudgePrompt(task(), "out", judgeConfig());
    expect(prompt).toMatch(/score/);
    expect(prompt).toMatch(/passed/);
    expect(prompt).toMatch(/reasoning/);
    expect(prompt).toMatch(/issues/);
    expect(prompt).toMatch(/JSON/);
  });

  it("uses the custom system prompt when provided", () => {
    const prompt = buildJudgePrompt(
      task(),
      "out",
      judgeConfig({ systemPrompt: "CUSTOM_SYSTEM_PROMPT_HERE" }),
    );
    expect(prompt).toContain("CUSTOM_SYSTEM_PROMPT_HERE");
  });

  it("handles empty output gracefully", () => {
    const prompt = buildJudgePrompt(task(), "", judgeConfig());
    expect(prompt).toContain("(no output)");
  });
});

// ─── parseJudgeResponse ──────────────────────────────────────────────

describe("parseJudgeResponse", () => {
  it("parses valid JSON", () => {
    const run = runResult();
    const v = parseJudgeResponse(
      '{"score": 85, "passed": true, "reasoning": "well done", "issues": ["minor typo"]}',
      2,
      run,
    );
    expect(v.runIndex).toBe(2);
    expect(v.score).toBe(85);
    expect(v.passed).toBe(true);
    expect(v.reasoning).toBe("well done");
    expect(v.issues).toEqual(["minor typo"]);
    expect(v.taskId).toBe(run.taskId);
    expect(v.modelId).toBe(run.modelId);
    expect(v.pluginIds).toEqual(run.pluginIds);
  });

  it("parses JSON wrapped in a ```json markdown block", () => {
    const run = runResult();
    const v = parseJudgeResponse(
      'Here is my evaluation:\n```json\n{"score": 70, "passed": true, "reasoning": "ok", "issues": []}\n```\nDone.',
      0,
      run,
    );
    expect(v.score).toBe(70);
    expect(v.passed).toBe(true);
  });

  it("parses JSON wrapped in a bare ``` block", () => {
    const run = runResult();
    const v = parseJudgeResponse(
      '```\n{"score": 50, "passed": false, "reasoning": "bad", "issues": ["x"]}\n```',
      0,
      run,
    );
    expect(v.score).toBe(50);
    expect(v.passed).toBe(false);
    expect(v.issues).toEqual(["x"]);
  });

  it("parses JSON embedded in surrounding prose", () => {
    const run = runResult();
    const v = parseJudgeResponse(
      'My verdict: {"score": 92, "passed": true, "reasoning": "great", "issues": []} thanks',
      0,
      run,
    );
    expect(v.score).toBe(92);
    expect(v.passed).toBe(true);
  });

  it("falls back to score=0, passed=false on invalid JSON", () => {
    const run = runResult();
    const v = parseJudgeResponse("this is not json at all", 0, run);
    expect(v.score).toBe(0);
    expect(v.passed).toBe(false);
    expect(v.issues).toEqual([]);
  });

  it("falls back to score=0 on empty response", () => {
    const run = runResult();
    const v = parseJudgeResponse("", 0, run);
    expect(v.score).toBe(0);
    expect(v.passed).toBe(false);
  });

  it("derives passed from score (>=70) when passed field is missing", () => {
    const run = runResult();
    const v = parseJudgeResponse(
      '{"score": 75, "reasoning": "decent", "issues": []}',
      0,
      run,
    );
    expect(v.passed).toBe(true);
  });

  it("derives passed=false when score < 70 and passed is missing", () => {
    const run = runResult();
    const v = parseJudgeResponse(
      '{"score": 60, "reasoning": "decent", "issues": []}',
      0,
      run,
    );
    expect(v.passed).toBe(false);
  });

  it("filters non-string issues", () => {
    const run = runResult();
    const v = parseJudgeResponse(
      '{"score": 80, "passed": true, "reasoning": "ok", "issues": ["real", 42, null, "also real"]}',
      0,
      run,
    );
    expect(v.issues).toEqual(["real", "also real"]);
  });

  it("defaults missing score to 0", () => {
    const run = runResult();
    const v = parseJudgeResponse(
      '{"passed": true, "reasoning": "ok", "issues": []}',
      0,
      run,
    );
    expect(v.score).toBe(0);
  });
});

// ─── compareCombos ───────────────────────────────────────────────────

describe("compareCombos", () => {
  it("computes deltas as candidate - baseline", () => {
    const baseline = runResult({
      pluginIds: [],
      metrics: metrics({ totalTokens: 1000, toolCallCount: 10, llmCallCount: 5, executionTimeMs: 10000 }),
      verdicts: [verdict({ score: 70 })],
    });
    const candidate = runResult({
      pluginIds: ["sverka"],
      metrics: metrics({ totalTokens: 800, toolCallCount: 8, llmCallCount: 4, executionTimeMs: 8000 }),
      verdicts: [verdict({ score: 90 })],
    });

    const cmp = compareCombos(baseline, candidate);
    expect(cmp.deltaTokens).toBe(-200);
    expect(cmp.deltaToolCalls).toBe(-2);
    expect(cmp.deltaLlmCalls).toBe(-1);
    expect(cmp.deltaTimeMs).toBe(-2000);
    expect(cmp.deltaJudgeScore).toBe(20);
  });

  it("labels baseline as no-plugins and candidate with plugin ids", () => {
    const baseline = runResult({ pluginIds: [] });
    const candidate = runResult({ pluginIds: ["sverka", "extra"] });
    const cmp = compareCombos(baseline, candidate);
    expect(cmp.baseline).toBe("no-plugins");
    expect(cmp.candidate).toBe("sverka,extra");
  });

  it("marks candidateBetter=true when judge score improved", () => {
    const baseline = runResult({ verdicts: [verdict({ score: 60 })] });
    const candidate = runResult({ pluginIds: ["sverka"], verdicts: [verdict({ score: 85 })] });
    const cmp = compareCombos(baseline, candidate);
    expect(cmp.deltaJudgeScore).toBe(25);
    expect(cmp.candidateBetter).toBe(true);
  });

  it("marks candidateBetter=true when equal score but fewer resources", () => {
    const baseline = runResult({
      metrics: metrics({ totalTokens: 1000, toolCallCount: 10, llmCallCount: 5, executionTimeMs: 10000 }),
      verdicts: [verdict({ score: 80 })],
    });
    const candidate = runResult({
      pluginIds: ["sverka"],
      metrics: metrics({ totalTokens: 800, toolCallCount: 8, llmCallCount: 4, executionTimeMs: 8000 }),
      verdicts: [verdict({ score: 80 })],
    });
    const cmp = compareCombos(baseline, candidate);
    expect(cmp.deltaJudgeScore).toBe(0);
    expect(cmp.candidateBetter).toBe(true);
  });

  it("marks candidateBetter=false when candidate uses more resources and same score", () => {
    const baseline = runResult({
      metrics: metrics({ totalTokens: 800, toolCallCount: 8, llmCallCount: 4, executionTimeMs: 8000 }),
      verdicts: [verdict({ score: 80 })],
    });
    const candidate = runResult({
      pluginIds: ["sverka"],
      metrics: metrics({ totalTokens: 1000, toolCallCount: 10, llmCallCount: 5, executionTimeMs: 10000 }),
      verdicts: [verdict({ score: 80 })],
    });
    const cmp = compareCombos(baseline, candidate);
    expect(cmp.candidateBetter).toBe(false);
  });

  it("marks candidateBetter=false when judge score regressed", () => {
    const baseline = runResult({ verdicts: [verdict({ score: 90 })] });
    const candidate = runResult({
      pluginIds: ["sverka"],
      verdicts: [verdict({ score: 70 })],
    });
    const cmp = compareCombos(baseline, candidate);
    expect(cmp.deltaJudgeScore).toBe(-20);
    expect(cmp.candidateBetter).toBe(false);
  });

  it("treats missing verdicts as score 0", () => {
    const baseline = runResult({ verdicts: [] });
    const candidate = runResult({ pluginIds: ["sverka"], verdicts: [] });
    const cmp = compareCombos(baseline, candidate);
    expect(cmp.deltaJudgeScore).toBe(0);
  });

  it("averages multiple verdicts for the judge score", () => {
    const baseline = runResult({ verdicts: [verdict({ score: 60 }), verdict({ score: 80 })] });
    const candidate = runResult({ pluginIds: ["sverka"], verdicts: [verdict({ score: 90 }), verdict({ score: 90 })] });
    const cmp = compareCombos(baseline, candidate);
    // baseline avg = 70, candidate avg = 90 → delta = 20
    expect(cmp.deltaJudgeScore).toBe(20);
  });
});

// ─── judgeRun ────────────────────────────────────────────────────────

describe("judgeRun", () => {
  it("spawns the judge agent, sends the prompt, and returns a verdict", async () => {
    const sentPrompts: string[] = [];
    const agent: AgentAdapter = {
      id: "mock-judge",
      spawn: (): AgentProcess => ({
        run: async (prompt: string) => {
          sentPrompts.push(prompt);
          return runResult({
            output: '{"score": 88, "passed": true, "reasoning": "solid", "issues": ["x"]}',
          });
        },
        kill: () => {},
      }),
    };
    const run = runResult({ output: "the agent output" });
    const v = await judgeRun(run, task(), { model: judgeModel, agent }, 3);

    expect(sentPrompts).toHaveLength(1);
    // The prompt is built from the task + the run's output.
    expect(sentPrompts[0]).toContain("Fix the bug in src/foo.ts");
    expect(sentPrompts[0]).toContain("the agent output");
    // Verdict parsed from the mock response.
    expect(v.runIndex).toBe(3);
    expect(v.score).toBe(88);
    expect(v.passed).toBe(true);
    expect(v.reasoning).toBe("solid");
    expect(v.issues).toEqual(["x"]);
    expect(v.taskId).toBe(run.taskId);
  });

  it("kills the judge agent after collecting the response", async () => {
    let killed = 0;
    const agent: AgentAdapter = {
      id: "mock-judge",
      spawn: (): AgentProcess => ({
        run: async () => runResult({ output: '{"score": 50, "passed": false, "reasoning": "no", "issues": []}' }),
        kill: () => { killed++; },
      }),
    };
    await judgeRun(runResult(), task(), { model: judgeModel, agent }, 0);
    expect(killed).toBe(1);
  });

  it("kills the judge agent even when run throws", async () => {
    let killed = 0;
    const agent: AgentAdapter = {
      id: "mock-judge",
      spawn: (): AgentProcess => ({
        run: async () => { throw new Error("judge crashed"); },
        kill: () => { killed++; },
      }),
    };
    const v = await judgeRun(runResult(), task(), { model: judgeModel, agent }, 0);
    expect(killed).toBe(1);
    expect(v.score).toBe(0);
    expect(v.passed).toBe(false);
    expect(v.reasoning).toBe("judge crashed");
  });

  it("returns a zero verdict when the judge output is unparseable", async () => {
    const agent: AgentAdapter = {
      id: "mock-judge",
      spawn: (): AgentProcess => ({
        run: async () => runResult({ output: "not json" }),
        kill: () => {},
      }),
    };
    const v = await judgeRun(runResult(), task(), { model: judgeModel, agent }, 0);
    expect(v.score).toBe(0);
    expect(v.passed).toBe(false);
  });
});

// ─── judgeAllRuns ────────────────────────────────────────────────────

describe("judgeAllRuns", () => {
  it("judges each run once by default and pairs with the matching task", async () => {
    let runCount = 0;
    const agent: AgentAdapter = {
      id: "mock-judge",
      spawn: (): AgentProcess => ({
        run: async () => {
          runCount++;
          return runResult({ output: '{"score": 75, "passed": true, "reasoning": "ok", "issues": []}' });
        },
        kill: () => {},
      }),
    };
    const tasks = [task(), { id: "t2", name: "T2", prompt: "do t2" }];
    const results = [
      runResult({ taskId: "t1" }),
      runResult({ taskId: "t2", output: "t2 output" }),
    ];
    const verdicts = await judgeAllRuns(results, tasks, { model: judgeModel, agent });
    expect(verdicts).toHaveLength(2);
    expect(runCount).toBe(2);
    expect(verdicts[0]?.taskId).toBe("t1");
    expect(verdicts[1]?.taskId).toBe("t2");
    // runIndex reflects position in results.
    expect(verdicts[0]?.runIndex).toBe(0);
    expect(verdicts[1]?.runIndex).toBe(1);
  });

  it("respects config.repetitions, running the judge N times per run", async () => {
    let runCount = 0;
    const agent: AgentAdapter = {
      id: "mock-judge",
      spawn: (): AgentProcess => ({
        run: async () => {
          runCount++;
          return runResult({ output: '{"score": 70, "passed": true, "reasoning": "ok", "issues": []}' });
        },
        kill: () => {},
      }),
    };
    const verdicts = await judgeAllRuns(
      [runResult({ taskId: "t1" })],
      [task()],
      { model: judgeModel, agent, repetitions: 3 },
    );
    expect(verdicts).toHaveLength(3);
    expect(runCount).toBe(3);
  });

  it("skips runs whose task is not found", async () => {
    let runCount = 0;
    const agent: AgentAdapter = {
      id: "mock-judge",
      spawn: (): AgentProcess => ({
        run: async () => {
          runCount++;
          return runResult({ output: '{"score": 70, "passed": true, "reasoning": "ok", "issues": []}' });
        },
        kill: () => {},
      }),
    };
    const verdicts = await judgeAllRuns(
      [runResult({ taskId: "unknown" })],
      [task()],
      { model: judgeModel, agent },
    );
    expect(verdicts).toHaveLength(0);
    expect(runCount).toBe(0);
  });

  it("returns an empty array for no results", async () => {
    const agent: AgentAdapter = {
      id: "mock-judge",
      spawn: (): AgentProcess => ({
        run: async () => runResult({ output: "{}" }),
        kill: () => {},
      }),
    };
    const verdicts = await judgeAllRuns([], [task()], { model: judgeModel, agent });
    expect(verdicts).toEqual([]);
  });
});
