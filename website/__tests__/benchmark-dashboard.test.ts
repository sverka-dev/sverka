import { describe, it, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const benchDir = join(import.meta.dirname, "..", "public", "benchmark");

describe("benchmark dashboard files", () => {
  it("index.html exists", () => {
    expect(existsSync(join(benchDir, "index.html"))).toBe(true);
  });

  it("sample-result.json exists and is valid BenchmarkResult", () => {
    const path = join(benchDir, "sample-result.json");
    expect(existsSync(path)).toBe(true);
    const data = JSON.parse(readFileSync(path, "utf-8"));
    expect(data.timestamp).toBeTruthy();
    expect(data.model).toBeTruthy();
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.summary["raw-shell"]).toBeDefined();
    expect(data.summary.sverka).toBeDefined();
  });

  it("index.html is valid HTML with title and script", () => {
    const html = readFileSync(join(benchDir, "index.html"), "utf-8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>");
    expect(html).toContain("</html>");
    expect(html).toContain("<script>");
  });

  it("index.html contains comparison table structure", () => {
    const html = readFileSync(join(benchDir, "index.html"), "utf-8");
    expect(html).toContain('id="results-table"');
    expect(html).toContain('id="summary"');
    expect(html).toContain('id="header-meta"');
  });

  it("index.html links to trace viewer", () => {
    const html = readFileSync(join(benchDir, "index.html"), "utf-8");
    expect(html).toContain("trace.html");
    expect(html).toContain("trace-link");
  });

  it("trace.html exists and is valid HTML", () => {
    const path = join(benchDir, "trace.html");
    expect(existsSync(path)).toBe(true);
    const html = readFileSync(path, "utf-8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>");
    expect(html).toContain("</html>");
    expect(html).toContain("<script>");
  });

  it("trace.html has hash-based routing", () => {
    const html = readFileSync(join(benchDir, "trace.html"), "utf-8");
    expect(html).toContain("hashchange");
    expect(html).toContain("parseParams");
    expect(html).toContain("#/trace/");
  });

  it("trace.html has no external CSS/JS dependencies", () => {
    const html = readFileSync(join(benchDir, "trace.html"), "utf-8");
    expect(html).not.toMatch(/<link[^>]*rel=["']stylesheet["']/);
    expect(html).not.toMatch(/<script[^>]*src=["']https?:/);
  });

  it("trace.html uses dark theme", () => {
    const html = readFileSync(join(benchDir, "trace.html"), "utf-8");
    expect(html).toContain('data-theme="dark"');
    expect(html).toMatch(/--bg:\s*#0d1117/);
  });

  it("trace data files exist for all 5 tasks", () => {
    const taskIds = ["run-checks", "discover", "create-config", "compile-github", "multi-step"];
    for (const taskId of taskIds) {
      const path = join(benchDir, "traces", taskId, "trace.json");
      expect(existsSync(path)).toBe(true);
      const data = JSON.parse(readFileSync(path, "utf-8"));
      expect(data.taskId).toBe(taskId);
      expect(data.prompt).toBeTruthy();
      expect(data.agents["raw-shell"]).toBeDefined();
      expect(data.agents.sverka).toBeDefined();
    }
  });

  it("trace data has LLM call counts and steps", () => {
    const path = join(benchDir, "traces", "run-checks", "trace.json");
    const data = JSON.parse(readFileSync(path, "utf-8"));
    const raw = data.agents["raw-shell"];
    expect(raw.llmCallCount).toBeGreaterThan(0);
    expect(raw.steps.length).toBeGreaterThan(0);
    expect(raw.finalMetrics.totalPromptTokens).toBeGreaterThan(0);
    expect(raw.model).toBeTruthy();
    // Each step has required fields
    const step = raw.steps[0];
    expect(step.stepId).toBeDefined();
    expect(step.source).toBeDefined();
    expect(step.timestamp).toBeDefined();
    expect(typeof step.isLlmCall).toBe("boolean");
  });

  it("trace data shows sverka uses fewer LLM calls than raw-shell", () => {
    const taskIds = ["run-checks", "discover", "create-config", "compile-github", "multi-step"];
    for (const taskId of taskIds) {
      const path = join(benchDir, "traces", taskId, "trace.json");
      const data = JSON.parse(readFileSync(path, "utf-8"));
      const rawCalls = data.agents["raw-shell"].llmCallCount;
      const sverkaCalls = data.agents.sverka.llmCallCount;
      expect(sverkaCalls).toBeLessThan(rawCalls);
    }
  });

  it("index.html has no external CSS/JS dependencies", () => {
    const html = readFileSync(join(benchDir, "index.html"), "utf-8");
    // No <link> to external stylesheets, no <script src="http...">
    expect(html).not.toMatch(/<link[^>]*rel=["']stylesheet["']/);
    expect(html).not.toMatch(/<script[^>]*src=["']https?:/);
  });

  it("index.html uses dark theme", () => {
    const html = readFileSync(join(benchDir, "index.html"), "utf-8");
    expect(html).toContain("data-theme=\"dark\"");
    expect(html).toMatch(/--bg:\s*#0d1117/);
  });

  it("sample-result.json has paired results for each task", () => {
    const data = JSON.parse(
      readFileSync(join(benchDir, "sample-result.json"), "utf-8"),
    );
    const taskIds = new Set(data.results.map((r: any) => r.taskId));
    for (const taskId of taskIds) {
      const runs = data.results.filter((r: any) => r.taskId === taskId);
      expect(runs.length).toBe(2);
      const types = runs.map((r: any) => r.agentType).sort();
      expect(types).toEqual(["raw-shell", "sverka"]);
    }
  });

  it("sample-result.json summary averages match results", () => {
    const data = JSON.parse(
      readFileSync(join(benchDir, "sample-result.json"), "utf-8"),
    );
    const rawResults = data.results.filter((r: any) => r.agentType === "raw-shell");
    const rawSummary = data.summary["raw-shell"];
    expect(rawSummary.totalTasks).toBe(rawResults.length);
    expect(rawSummary.successCount).toBe(
      rawResults.filter((r: any) => r.success).length,
    );
    const avgTokens = rawResults.reduce(
      (sum: number, r: any) => sum + r.metrics.totalTokens, 0,
    ) / rawResults.length;
    expect(rawSummary.avgTotalTokens).toBe(Math.round(avgTokens));
  });
});

describe("arena sample result", () => {
  const arenaPath = join(benchDir, "arena-sample.json");

  it("arena-sample.json exists and is valid JSON", () => {
    expect(existsSync(arenaPath)).toBe(true);
    const data = JSON.parse(readFileSync(arenaPath, "utf-8"));
    expect(data.timestamp).toBeTruthy();
  });

  it("arena-sample.json has correct ArenaResult structure", () => {
    const data = JSON.parse(readFileSync(arenaPath, "utf-8"));
    expect(data.config).toBeDefined();
    expect(Array.isArray(data.config.models)).toBe(true);
    expect(data.config.models.length).toBeGreaterThan(0);
    expect(Array.isArray(data.config.plugins)).toBe(true);
    expect(Array.isArray(data.config.tasks)).toBe(true);
    expect(data.config.tasks.length).toBe(3);
    expect(data.config.repetitions).toBeDefined();
  });

  it("arena-sample.json has results array with pluginIds field", () => {
    const data = JSON.parse(readFileSync(arenaPath, "utf-8"));
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.results.length).toBeGreaterThan(0);
    for (const r of data.results) {
      expect(r.taskId).toBeDefined();
      expect(r.modelId).toBeDefined();
      expect(Array.isArray(r.pluginIds)).toBe(true);
      expect(r.metrics).toBeDefined();
      expect(r.metrics.totalTokens).toBeDefined();
      expect(r.metrics.toolCallCount).toBeDefined();
      expect(r.metrics.llmCallCount).toBeDefined();
      expect(r.metrics.executionTimeMs).toBeDefined();
      expect(typeof r.success).toBe("boolean");
    }
  });

  it("arena-sample.json has results for all task × plugin combinations", () => {
    const data = JSON.parse(readFileSync(arenaPath, "utf-8"));
    const tasks = data.config.tasks;
    const plugins = data.config.plugins;
    // 2 combos: empty (raw) and all plugins (sverka)
    const expectedCombos = 2;
    expect(data.results.length).toBe(tasks.length * expectedCombos);
    for (const task of tasks) {
      const taskResults = data.results.filter((r: any) => r.taskId === task);
      expect(taskResults.length).toBe(expectedCombos);
      const hasRaw = taskResults.some((r: any) => r.pluginIds.length === 0);
      const hasSverka = taskResults.some(
        (r: any) => r.pluginIds.length === 1 && r.pluginIds[0] === "sverka",
      );
      expect(hasRaw).toBe(true);
      expect(hasSverka).toBe(true);
    }
  });

  it("arena-sample.json has aggregates array", () => {
    const data = JSON.parse(readFileSync(arenaPath, "utf-8"));
    expect(Array.isArray(data.aggregates)).toBe(true);
    expect(data.aggregates.length).toBe(2);
    for (const agg of data.aggregates) {
      expect(agg.totalRuns).toBeDefined();
      expect(agg.successCount).toBeDefined();
      expect(agg.avgTotalTokens).toBeDefined();
      expect(agg.avgToolCalls).toBeDefined();
      expect(agg.avgLlmCalls).toBeDefined();
      expect(agg.avgExecutionTimeMs).toBeDefined();
    }
  });

  it("arena-sample.json uses realistic numbers matching real benchmark data", () => {
    const data = JSON.parse(readFileSync(arenaPath, "utf-8"));
    const fixTestRaw = data.results.find(
      (r: any) => r.taskId === "fix-test" && r.pluginIds.length === 0,
    );
    expect(fixTestRaw).toBeDefined();
    expect(fixTestRaw.metrics.totalTokens).toBeGreaterThan(30000);
    expect(fixTestRaw.metrics.toolCallCount).toBeGreaterThan(3);
    expect(fixTestRaw.metrics.executionTimeMs).toBeGreaterThan(30000);

    const fixTestSverka = data.results.find(
      (r: any) => r.taskId === "fix-test" && r.pluginIds.includes("sverka"),
    );
    expect(fixTestSverka).toBeDefined();
    expect(fixTestSverka.metrics.toolCallCount).toBeLessThan(fixTestRaw.metrics.toolCallCount);
    expect(fixTestSverka.metrics.llmCallCount).toBeLessThan(fixTestRaw.metrics.llmCallCount);
  });
});

describe("arena dashboard matrix view", () => {
  it("index.html contains matrix view elements for arena format", () => {
    const html = readFileSync(join(benchDir, "index.html"), "utf-8");
    expect(html).toContain('id="matrix-table"');
    expect(html).toContain('id="matrix-container"');
    expect(html).toContain("matrix-table");
    expect(html).toContain("isArenaResult");
    expect(html).toContain("renderArenaMatrix");
    expect(html).toContain("pluginCombinations");
  });

  it("index.html has metric selector for matrix cells", () => {
    const html = readFileSync(join(benchDir, "index.html"), "utf-8");
    expect(html).toContain('name="metric"');
    expect(html).toContain("totalTokens");
    expect(html).toContain("toolCallCount");
    expect(html).toContain("llmCallCount");
    expect(html).toContain("executionTimeMs");
  });

  it("index.html has view toggle between matrix and classic", () => {
    const html = readFileSync(join(benchDir, "index.html"), "utf-8");
    expect(html).toContain('id="view-toggle"');
    expect(html).toContain("toggle-matrix");
    expect(html).toContain("toggle-classic");
  });

  it("index.html matrix cells link to trace.html with URL params", () => {
    const html = readFileSync(join(benchDir, "index.html"), "utf-8");
    expect(html).toContain("trace.html?");
    expect(html).toContain("task=");
    expect(html).toContain("model=");
    expect(html).toContain("plugins=");
  });

  it("index.html maintains backward compatibility with classic format", () => {
    const html = readFileSync(join(benchDir, "index.html"), "utf-8");
    // Classic view elements still present
    expect(html).toContain('id="results-table"');
    expect(html).toContain("renderTable");
    expect(html).toContain("renderSummary");
    expect(html).toContain("renderHeader");
  });
});

describe("arena trace viewer", () => {
  it("trace.html accepts URL params for task/model/plugins", () => {
    const html = readFileSync(join(benchDir, "trace.html"), "utf-8");
    expect(html).toContain("parseParams");
    expect(html).toContain('params.get("task")');
    expect(html).toContain('params.get("model")');
    expect(html).toContain('params.get("plugins")');
    expect(html).toContain("URLSearchParams");
  });

  it("trace.html fetches trace by combo hash for arena format", () => {
    const html = readFileSync(join(benchDir, "trace.html"), "utf-8");
    expect(html).toContain("comboHash");
    expect(html).toContain("loadTraceArena");
  });

  it("trace.html falls back to classic trace.json for backward compat", () => {
    const html = readFileSync(join(benchDir, "trace.html"), "utf-8");
    expect(html).toContain("loadTraceClassic");
    expect(html).toContain("trace.json");
    expect(html).toContain("#/trace/");
  });

  it("trace.html has expandable tool call details", () => {
    const html = readFileSync(join(benchDir, "trace.html"), "utf-8");
    expect(html).toContain("renderToolCalls");
    expect(html).toContain("tool-call");
    expect(html).toContain("functionName");
    expect(html).toContain("arguments");
  });

  it("trace.html has running token counter per step", () => {
    const html = readFileSync(join(benchDir, "trace.html"), "utf-8");
    expect(html).toContain("runningTokens");
    expect(html).toContain("step-token-badge");
  });

  it("trace.html shows prompt at top", () => {
    const html = readFileSync(join(benchDir, "trace.html"), "utf-8");
    expect(html).toContain("renderPrompt");
    expect(html).toContain("prompt-container");
    expect(html).toContain("Task Prompt");
  });

  it("trace.html has config selector for side-by-side comparison", () => {
    const html = readFileSync(join(benchDir, "trace.html"), "utf-8");
    expect(html).toContain("config-selector");
    expect(html).toContain("config-a-select");
    expect(html).toContain("config-b-select");
    expect(html).toContain("renderTraceArena");
  });

  it("trace.html maintains backward compat with hash routing", () => {
    const html = readFileSync(join(benchDir, "trace.html"), "utf-8");
    expect(html).toContain("hashchange");
    expect(html).toContain("#/trace/");
    expect(html).toContain("renderTraceClassic");
  });
});

describe("workbench case navigation", () => {
  it("index.html has sidebar for case list navigation", () => {
    const html = readFileSync(join(benchDir, "index.html"), "utf-8");
    expect(html).toContain('id="sidebar"');
    expect(html).toContain('id="case-list"');
    expect(html).toContain("case-item");
    expect(html).toContain("renderSidebar");
  });

  it("index.html has case detail view container", () => {
    const html = readFileSync(join(benchDir, "index.html"), "utf-8");
    expect(html).toContain('id="workbench-case"');
    expect(html).toContain('id="case-detail"');
    expect(html).toContain("renderCaseDetail");
  });

  it("index.html has overview view container", () => {
    const html = readFileSync(join(benchDir, "index.html"), "utf-8");
    expect(html).toContain('id="workbench-overview"');
    expect(html).toContain('id="case-cards"');
    expect(html).toContain("renderOverview");
  });

  it("index.html uses hash-based routing for case navigation", () => {
    const html = readFileSync(join(benchDir, "index.html"), "utf-8");
    expect(html).toContain("#/case/");
    expect(html).toContain("handleRoute");
    expect(html).toContain("hashchange");
    expect(html).toContain("showCase");
    expect(html).toContain("showOverview");
  });

  it("index.html has config summary bar", () => {
    const html = readFileSync(join(benchDir, "index.html"), "utf-8");
    expect(html).toContain('id="config-summary"');
    expect(html).toContain("Agent Benchmark Workbench");
  });

  it("index.html has aggregate summary section", () => {
    const html = readFileSync(join(benchDir, "index.html"), "utf-8");
    expect(html).toContain('id="aggregate-summary"');
    expect(html).toContain("renderAggregateSummary");
  });

  it("index.html case cards link to case detail via hash route", () => {
    const html = readFileSync(join(benchDir, "index.html"), "utf-8");
    expect(html).toContain("#/case/");
    expect(html).toContain("case-card");
  });

  it("index.html has status indicators for cases", () => {
    const html = readFileSync(join(benchDir, "index.html"), "utf-8");
    expect(html).toContain("status-dot");
    expect(html).toContain("judgePassRate");
  });
});

describe("workbench AI report elements", () => {
  it("index.html has AI report section with judge verdicts", () => {
    const html = readFileSync(join(benchDir, "index.html"), "utf-8");
    expect(html).toContain("ai-report");
    expect(html).toContain("renderAIReport");
    expect(html).toContain("Judge Verdict");
    expect(html).toContain("judge-badge");
  });

  it("index.html has comparison table for AI report", () => {
    const html = readFileSync(join(benchDir, "index.html"), "utf-8");
    expect(html).toContain("comparison-table");
    expect(html).toContain("Comparison Table");
    expect(html).toContain("deltaJudgeScore");
    expect(html).toContain("candidateBetter");
  });

  it("index.html displays AI summary from analysis", () => {
    const html = readFileSync(join(benchDir, "index.html"), "utf-8");
    expect(html).toContain("ai-summary");
    expect(html).toContain("analysis.summary");
    expect(html).toContain("findAnalysis");
  });

  it("index.html has collapsible run result cards", () => {
    const html = readFileSync(join(benchDir, "index.html"), "utf-8");
    expect(html).toContain("run-card");
    expect(html).toContain("renderRunCard");
    expect(html).toContain("expanded");
  });

  it("index.html run cards show agent output", () => {
    const html = readFileSync(join(benchDir, "index.html"), "utf-8");
    expect(html).toContain("Agent Output");
    expect(html).toContain("run-output");
  });

  it("index.html run cards show judge verdict with reasoning and issues", () => {
    const html = readFileSync(join(benchDir, "index.html"), "utf-8");
    expect(html).toContain("Judge Verdict");
    expect(html).toContain("run-verdict-reasoning");
    expect(html).toContain("run-verdict-issues");
  });

  it("index.html run cards link to trace viewer with run param", () => {
    const html = readFileSync(join(benchDir, "index.html"), "utf-8");
    expect(html).toContain("trace.html?");
    expect(html).toContain("run=");
  });

  it("index.html displays original prompt in case detail", () => {
    const html = readFileSync(join(benchDir, "index.html"), "utf-8");
    expect(html).toContain("prompt-box");
    expect(html).toContain("Original Prompt");
  });
});

describe("arena-sample.json verdicts, output, analysis", () => {
  const arenaPath = join(benchDir, "arena-sample.json");

  it("arena-sample.json results have verdicts array with JudgeVerdict fields", () => {
    const data = JSON.parse(readFileSync(arenaPath, "utf-8"));
    expect(data.results.length).toBeGreaterThan(0);
    for (const r of data.results) {
      expect(Array.isArray(r.verdicts)).toBe(true);
      expect(r.verdicts.length).toBeGreaterThan(0);
      const v = r.verdicts[0];
      expect(typeof v.score).toBe("number");
      expect(v.score).toBeGreaterThanOrEqual(0);
      expect(v.score).toBeLessThanOrEqual(100);
      expect(typeof v.passed).toBe("boolean");
      expect(typeof v.reasoning).toBe("string");
      expect(v.reasoning.length).toBeGreaterThan(0);
      expect(Array.isArray(v.issues)).toBe(true);
      expect(v.taskId).toBe(r.taskId);
      expect(v.modelId).toBe(r.modelId);
    }
  });

  it("arena-sample.json results have output field with agent text response", () => {
    const data = JSON.parse(readFileSync(arenaPath, "utf-8"));
    for (const r of data.results) {
      expect(typeof r.output).toBe("string");
      expect(r.output.length).toBeGreaterThan(20);
    }
  });

  it("arena-sample.json has analysis array with CaseAnalysis per task", () => {
    const data = JSON.parse(readFileSync(arenaPath, "utf-8"));
    expect(Array.isArray(data.analysis)).toBe(true);
    expect(data.analysis.length).toBe(data.config.tasks.length);
    for (const a of data.analysis) {
      expect(a.taskId).toBeDefined();
      expect(a.taskName).toBeDefined();
      expect(a.prompt).toBeDefined();
      expect(Array.isArray(a.comparisons)).toBe(true);
      expect(a.comparisons.length).toBeGreaterThan(0);
      expect(a.summary).toBeDefined();
      expect(typeof a.summary).toBe("string");
      // Check comparison fields
      const c = a.comparisons[0];
      expect(c.baseline).toBeDefined();
      expect(c.candidate).toBeDefined();
      expect(typeof c.deltaTokens).toBe("number");
      expect(typeof c.deltaToolCalls).toBe("number");
      expect(typeof c.deltaLlmCalls).toBe("number");
      expect(typeof c.deltaTimeMs).toBe("number");
      expect(typeof c.deltaJudgeScore).toBe("number");
      expect(typeof c.candidateBetter).toBe("boolean");
    }
  });

  it("arena-sample.json aggregates have avgJudgeScore, judgePassCount, label", () => {
    const data = JSON.parse(readFileSync(arenaPath, "utf-8"));
    expect(data.aggregates.length).toBe(2);
    for (const agg of data.aggregates) {
      expect(typeof agg.avgJudgeScore).toBe("number");
      expect(agg.avgJudgeScore).toBeGreaterThanOrEqual(0);
      expect(agg.avgJudgeScore).toBeLessThanOrEqual(100);
      expect(typeof agg.judgePassCount).toBe("number");
      expect(typeof agg.label).toBe("string");
      expect(agg.label.length).toBeGreaterThan(0);
    }
  });

  it("arena-sample.json config has judgeModel", () => {
    const data = JSON.parse(readFileSync(arenaPath, "utf-8"));
    expect(data.config.judgeModel).toBeDefined();
    expect(typeof data.config.judgeModel).toBe("string");
  });

  it("arena-sample.json has realistic judge scores", () => {
    const data = JSON.parse(readFileSync(arenaPath, "utf-8"));
    for (const r of data.results) {
      const v = r.verdicts[0];
      expect(v.score).toBeGreaterThanOrEqual(60);
      expect(v.score).toBeLessThanOrEqual(100);
    }
  });

  it("arena-sample.json includes comparison data in analysis", () => {
    const data = JSON.parse(readFileSync(arenaPath, "utf-8"));
    expect(data.analysis.length).toBeGreaterThan(0);
    for (const a of data.analysis) {
      expect(a.comparisons.length).toBeGreaterThan(0);
      for (const c of a.comparisons) {
        expect(c.candidateBetter).toBeDefined();
        expect(c.deltaTokens).toBeDefined();
        expect(c.deltaJudgeScore).toBeDefined();
      }
    }
  });

  it("arena-sample.json verdict pass/fail is consistent with score threshold", () => {
    const data = JSON.parse(readFileSync(arenaPath, "utf-8"));
    // Threshold is 70: passed = score >= 70
    for (const r of data.results) {
      const v = r.verdicts[0];
      if (v.score >= 70) {
        expect(v.passed).toBe(true);
      } else {
        expect(v.passed).toBe(false);
      }
    }
  });
});

describe("generic plugin names (not hardcoded to sverka)", () => {
  it("index.html does not hardcode raw-shell vs sverka in workbench views", () => {
    const html = readFileSync(join(benchDir, "index.html"), "utf-8");
    // Workbench functions should be data-driven
    expect(html).toContain("pluginCombinations");
    expect(html).toContain("comboLabel");
    // Should not hardcode "raw-shell" in the workbench rendering functions
    // (only in legacy backward-compat section)
    const workbenchSection = html.substring(
      html.indexOf("renderSidebar"),
      html.indexOf("renderHeader"),
    );
    expect(workbenchSection).not.toContain('"raw-shell"');
    expect(workbenchSection).not.toContain('"sverka"');
  });

  it("index.html uses plugin names from config, not hardcoded", () => {
    const html = readFileSync(join(benchDir, "index.html"), "utf-8");
    // The combo label function should work with any plugin names
    expect(html).toContain("combo.length === 0");
    expect(html).toContain("combo.join");
  });

  it("index.html aggregate summary works with any plugin combo", () => {
    const html = readFileSync(join(benchDir, "index.html"), "utf-8");
    expect(html).toContain("findAggregate");
    expect(html).toContain("pluginCombinations");
  });

  it("trace.html judge verdict display works with any plugin names", () => {
    const html = readFileSync(join(benchDir, "trace.html"), "utf-8");
    expect(html).toContain("renderJudgeVerdict");
    expect(html).toContain("renderAgentOutput");
    expect(html).toContain("fetchArenaVerdictAndOutput");
    expect(html).toContain("findArenaResult");
  });

  it("trace.html has agent output container and judge verdict container", () => {
    const html = readFileSync(join(benchDir, "trace.html"), "utf-8");
    expect(html).toContain('id="agent-output-container"');
    expect(html).toContain('id="judge-verdict-container"');
    expect(html).toContain("agent-output-section");
    expect(html).toContain("judge-verdict-section");
  });

  it("trace.html accepts run URL param", () => {
    const html = readFileSync(join(benchDir, "trace.html"), "utf-8");
    expect(html).toContain('params.get("run")');
    expect(html).toContain("runIndex");
  });
});
