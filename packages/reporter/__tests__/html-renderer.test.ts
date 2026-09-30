import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { createHtmlRenderer } from "../src/html-renderer.js";
import {
  runStarted,
  stepSucceeded,
  stepFailed,
  stepSkipped,
  runCompleted,
} from "./helpers/fixtures.js";
import type { Finding, PolicyResult } from "@sverka/verification";
import type { DefinitionGraph } from "@sverka/workflow";

function makeFinding(
  severity: string,
  checkId: string,
  file = "src/index.ts",
): Finding {
  return {
    id: `${checkId}:fp-${severity}`,
    fingerprint: `fp-${severity}`,
    checkId,
    severity: severity as Finding["severity"],
    confidence: 0.5,
    message: "test finding",
    rule: "rule-1",
    file,
    startLine: 1,
    endLine: 1,
    source: {
      tool: "test",
      version: null,
      format: "sarif",
      originalRuleId: "rule-1",
      originalSeverity: null,
    },
  };
}

const PASS_RESULT: PolicyResult = {
  verdict: "pass",
  triggered: [],
  rules: [],
  summary: "pass: no findings triggered any rule",
};

const FAIL_RESULT: PolicyResult = {
  verdict: "fail",
  triggered: [{ finding: makeFinding("high", "ci/lint"), ruleIndex: 0 }],
  rules: [
    {
      ruleIndex: 0,
      triggered: true,
      matched: [makeFinding("high", "ci/lint")],
    },
  ],
  summary: "fail: 1 finding triggered 1 rule (1 high)",
};

const SAMPLE_GRAPH: DefinitionGraph = {
  project: {
    id: "proj",
    pipelines: [
      {
        id: "ci",
        inputs: {},
        entries: [],
        outputs: [],
        steps: [
          {
            id: "ci/build",
            runtime: { kind: "host" },
            operations: [{ kind: "shell", command: "echo" }],
            inputs: [],
            outputs: [],
            dependencies: [],
          },
          {
            id: "ci/test",
            runtime: { kind: "host" },
            operations: [{ kind: "shell", command: "echo" }],
            inputs: [],
            outputs: [],
            dependencies: [{ kind: "control", producer: "ci/build" }],
          },
        ],
      },
    ],
  },
};

let tmpDir: string;

beforeEach(async () => {
  tmpDir = join(
    process.cwd(),
    ".test-tmp-html",
    `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

/** Create a renderer, emit events, flush, and return the generated HTML. */
function renderHtml(
  events: Parameters<ReturnType<typeof createHtmlRenderer>["onEvent"]>[0][],
): string {
  const outputPath = join(tmpDir, "report.html");
  const renderer = createHtmlRenderer({ outputPath, graph: SAMPLE_GRAPH });
  for (const event of events) renderer.onEvent(event);
  renderer.flush();
  return readFileSync(outputPath, "utf-8");
}

/** Common event sequence: run started + completed with optional extra events. */
function withRun(
  ...extra: Parameters<ReturnType<typeof createHtmlRenderer>["onEvent"]>[0][]
): Parameters<ReturnType<typeof createHtmlRenderer>["onEvent"]>[0][] {
  return [
    runStarted("run-1", "plan-abc"),
    ...extra,
    runCompleted("run-1", "success", 100),
  ];
}

describe("HtmlRenderer", () => {
  it("9. flush produces HTML with DOCTYPE, title, header, sections", () => {
    const html = renderHtml(withRun(stepSucceeded("ci/build", 100)));
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>");
    expect(html).toContain("<header");
    expect(html).toContain('id="view-dag"');
    expect(html).toContain('id="findings"');
    expect(html).toContain('id="steps"');
  });

  it("10. run summary contains planId, status, duration", () => {
    const html = renderHtml([
      runStarted("run-1", "plan-abc"),
      runCompleted("run-1", "success", 560),
    ]);
    expect(html).toContain("plan-abc");
    expect(html).toContain("success");
    expect(html).toContain("560");
  });

  it("11. step details — a <details> element per step with status and duration", () => {
    const html = renderHtml([
      runStarted("run-1", "plan-abc"),
      stepSucceeded("ci/build", 120),
      stepFailed("ci/test", "exit code 1", 340),
      runCompleted("run-1", "failure", 500),
    ]);
    expect(html).toContain("<details");
    expect(html).toContain("ci/build");
    expect(html).toContain("ci/test");
    expect(html).toContain("succeeded");
    expect(html).toContain("failed");
    expect(html).toContain("120");
    expect(html).toContain("340");
  });

  it("12. findings table contains finding rows when onFindings is called", () => {
    const outputPath = join(tmpDir, "report.html");
    const renderer = createHtmlRenderer({ outputPath, graph: SAMPLE_GRAPH });
    renderer.onEvent(runStarted("run-1", "plan-abc"));
    renderer.onEvent(runCompleted("run-1", "success", 100));
    renderer.onFindings([
      makeFinding("high", "ci/lint"),
      makeFinding("medium", "ci/test"),
    ]);
    renderer.flush();
    const html = readFileSync(outputPath, "utf-8");
    expect(html).toContain("<table");
    expect(html).toContain("ci/lint");
    expect(html).toContain("ci/test");
    expect(html).toContain("high");
    expect(html).toContain("medium");
  });

  it("13. verdict banner contains pass/fail text", () => {
    const outputPath = join(tmpDir, "report.html");
    const renderer = createHtmlRenderer({ outputPath, graph: SAMPLE_GRAPH });
    renderer.onEvent(runStarted("run-1", "plan-abc"));
    renderer.onEvent(runCompleted("run-1", "success", 100));
    renderer.onFindings([makeFinding("high", "ci/lint")]);
    renderer.onVerdict(FAIL_RESULT);
    renderer.flush();
    const html = readFileSync(outputPath, "utf-8");
    expect(html).toContain("fail");
    expect(html).toContain('id="verdict"');
  });

  it("14. no findings — shows 'No findings' message", () => {
    const html = renderHtml(withRun());
    expect(html).toContain("No findings");
  });

  it("14a. failed step without findings — synthesized reason row", () => {
    const html = renderHtml(
      withRun(
        stepFailed("ci/format", "shell command failed with exit code 1", 50),
      ),
    );
    expect(html).toContain("ci/format:step-failure");
    expect(html).toContain("shell command failed with exit code 1");
    expect(html).toContain('data-severity="high"');
  });

  it("14b. failed step failure row includes stderr tail", () => {
    const html = renderHtml([
      runStarted("run-1", "plan-abc"),
      {
        type: "step-failed",
        stepId: "ci/format",
        error: "shell command failed with exit code 1",
        stderr: "Checking formatting...\n[warn] src/x.ts\n",
        durationMs: 50,
      },
      runCompleted("run-1", "failure", 100),
    ]);
    expect(html).toContain("[warn] src/x.ts");
  });

  it("14c. failed step WITH a matching finding — no synthesized duplicate", () => {
    const outputPath = join(tmpDir, "report.html");
    const renderer = createHtmlRenderer({ outputPath, graph: SAMPLE_GRAPH });
    renderer.onEvent(runStarted("run-1", "plan-abc"));
    renderer.onEvent(stepFailed("ci/lint", "boom", 10));
    renderer.onEvent(runCompleted("run-1", "failure", 100));
    renderer.onFindings([makeFinding("high", "ci/lint:no-var")]);
    renderer.flush();
    const html = readFileSync(outputPath, "utf-8");
    expect(html).toContain("ci/lint:no-var");
    expect(html).not.toContain("ci/lint:step-failure");
  });

  it("15. DAG data — HTML contains inline JSON with DagLayout nodes and edges", () => {
    const html = renderHtml(withRun());
    expect(html).toContain("ci/build");
    expect(html).toContain("ci/test");
  });

  it("16. dark theme — CSS contains dark color scheme", () => {
    const html = renderHtml(withRun());
    expect(html).toContain("<style");
    expect(html).toMatch(/background[^;]*#[0-9a-f]{3,6}/i);
    expect(html).toMatch(/color-scheme:\s*dark/i);
  });

  it("17. writes file to outputPath on flush", () => {
    const outputPath = join(tmpDir, "report.html");
    const renderer = createHtmlRenderer({ outputPath, graph: SAMPLE_GRAPH });
    renderer.onEvent(runStarted("run-1", "plan-abc"));
    renderer.onEvent(runCompleted("run-1", "success", 100));
    renderer.flush();
    expect(existsSync(outputPath)).toBe(true);
    const html = readFileSync(outputPath, "utf-8");
    expect(html.length).toBeGreaterThan(100);
  });

  it("18. self-contained — no external CDN scripts, static SVG views", () => {
    const html = renderHtml(withRun());
    // ReactFlow/UMD was dropped: report must not depend on CDN loads.
    expect(html).not.toContain("reactflow");
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).toContain("<svg");
    expect(html).toContain('id="view-gantt"');
    expect(html).toContain('id="view-dag"');
    expect(html).toContain('id="view-list"');
  });

  it("19. filter JS — HTML contains vanilla JS for findings filter/sort/search", () => {
    const outputPath = join(tmpDir, "report.html");
    const renderer = createHtmlRenderer({ outputPath, graph: SAMPLE_GRAPH });
    renderer.onEvent(runStarted("run-1", "plan-abc"));
    renderer.onEvent(runCompleted("run-1", "success", 100));
    renderer.onFindings([
      makeFinding("high", "ci/lint"),
      makeFinding("medium", "ci/test"),
    ]);
    renderer.flush();
    const html = readFileSync(outputPath, "utf-8");
    expect(html).toContain("filter");
    expect(html).toContain("search");
    expect(html).toContain("sort");
  });

  it("handles skipped steps in details", () => {
    const html = renderHtml([
      runStarted("run-1", "plan-abc"),
      stepSkipped("ci/build"),
      runCompleted("run-1", "success", 100),
    ]);
    expect(html).toContain("skipped");
  });

  it("pass verdict banner shows pass text", () => {
    const outputPath = join(tmpDir, "report.html");
    const renderer = createHtmlRenderer({ outputPath, graph: SAMPLE_GRAPH });
    renderer.onEvent(runStarted("run-1", "plan-abc"));
    renderer.onEvent(runCompleted("run-1", "success", 100));
    renderer.onFindings([]);
    renderer.onVerdict(PASS_RESULT);
    renderer.flush();
    const html = readFileSync(outputPath, "utf-8");
    expect(html).toContain("pass");
  });

  it("gantt — stamped events produce positioned bars", () => {
    const html = renderHtml([
      { type: "run-started", runId: "r", planId: "p", at: 1000 },
      { type: "step-started", stepId: "ci/build", at: 1100 },
      { type: "step-succeeded", stepId: "ci/build", durationMs: 400, at: 1500 },
      { type: "step-started", stepId: "ci/test", at: 1500 },
      { type: "step-succeeded", stepId: "ci/test", durationMs: 300, at: 1800 },
      {
        type: "run-completed",
        runId: "r",
        status: "success",
        durationMs: 800,
        at: 1800,
      },
    ]);
    expect(html).toContain('class="gantt"');
    expect(html).toContain('class="bar"');
    // bars carry tooltip with duration
    expect(html).toContain("400ms");
  });

  it("gantt — no timestamps renders a notice, not a fake chart", () => {
    const html = renderHtml(withRun(stepSucceeded("ci/build", 100)));
    expect(html).toContain("No timing data");
    expect(html).not.toContain('class="bar"');
  });

  it("context — links render as clickable anchors, meta as text", () => {
    const outputPath = join(tmpDir, "report.html");
    const renderer = createHtmlRenderer({
      outputPath,
      graph: SAMPLE_GRAPH,
      context: {
        generatedAt: "2026-01-01T00:00:00Z",
        command: "sverka run --format html",
        meta: [{ label: "Branch", value: "main" }],
        links: [
          { label: "Repo", url: "https://github.com/acme/x" },
          {
            label: "Commit",
            url: "https://github.com/acme/x/commit/abc123",
          },
        ],
      },
    });
    renderer.onEvent(runStarted("run-1", "plan-abc"));
    renderer.onEvent(runCompleted("run-1", "success", 100));
    renderer.flush();
    const html = readFileSync(outputPath, "utf-8");
    expect(html).toContain('href="https://github.com/acme/x"');
    expect(html).toContain("https://github.com/acme/x/commit/abc123");
    expect(html).toContain("Branch");
    expect(html).toContain("sverka run --format html");
  });

  it("context — link values are HTML-escaped", () => {
    const outputPath = join(tmpDir, "report.html");
    const renderer = createHtmlRenderer({
      outputPath,
      context: {
        links: [{ label: "x", url: 'https://e.com/"onload="alert(1)' }],
      },
    });
    renderer.onEvent(runStarted("r", "p"));
    renderer.onEvent(runCompleted("r", "success", 1));
    renderer.flush();
    const html = readFileSync(outputPath, "utf-8");
    expect(html).not.toContain('"onload="');
    expect(html).toContain("&quot;onload=&quot;");
  });

  it("context — non-http(s) link schemes render as inert text", () => {
    const outputPath = join(tmpDir, "report.html");
    const renderer = createHtmlRenderer({
      outputPath,
      context: {
        links: [
          { label: "evil", url: "javascript:alert(1)" },
          { label: "ok", url: "https://example.com" },
        ],
      },
    });
    renderer.onEvent(runStarted("r", "p"));
    renderer.onEvent(runCompleted("r", "success", 1));
    renderer.flush();
    const html = readFileSync(outputPath, "utf-8");
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('href="https://example.com"');
  });

  it("steps are clickable — data-step on every view, findings wired to checkId", () => {
    const html = renderHtml([
      { type: "run-started", runId: "r", planId: "p", at: 1000 },
      { type: "step-started", stepId: "ci/build", at: 1100 },
      {
        type: "step-succeeded",
        stepId: "ci/build",
        durationMs: 100,
        at: 1200,
      },
      {
        type: "run-completed",
        runId: "r",
        status: "success",
        durationMs: 200,
        at: 1200,
      },
    ]);
    // every view carries data-step (gantt row, dag node, tree node, list chip)
    expect(html).toContain('class="gantt-step" data-step="ci/build"');
    expect(html).toContain('class="dag-node" data-step="ci/build"');
    expect(html).toContain('data-step="ci/build"');
    expect(html).toContain('class="step-findings" data-step="ci/build"');
    // JS filters findings by the step's checkId (rule-qualified ids
    // match on their step-id prefix, mirroring the policy evaluator)
    expect(html).toContain("stepFilter");
    expect(html).toContain("stepMatches(stepFilter, f.checkId)");
    expect(html).toContain('bareCheck.indexOf(bareStep + ":") === 0');
    expect(html).toContain("step-filter-chip");
  });

  it("dag — zoom and pan viewport with padded viewBox and controls", () => {
    const html = renderHtml(withRun(stepSucceeded("ci/build", 100)));
    expect(html).toContain('class="dag-viewport"');
    expect(html).toContain('id="dag-svg"');
    expect(html).toContain('data-dag-zoom="in"');
    expect(html).toContain('data-dag-zoom="fit"');
    // viewBox is padded beyond the content box (negative origin)
    expect(html).toMatch(/viewBox="-40 -40 \d+ \d+"/);
    expect(html).toContain('data-vb-lr="-40 -40');
    expect(html).toContain('data-vb-tb="-40 -40');
    // wheel zoom + pointer pan wiring
    expect(html).toContain('"wheel"');
    expect(html).toContain('"pointermove"');
    // drag-ended clicks must not toggle the step filter
    expect(html).toContain("__dagMoved");
  });

  it("dag — direction toggle renders both LR and TB layers", () => {
    const html = renderHtml(withRun(stepSucceeded("ci/build", 100)));
    expect(html).toContain('class="dag-dir" data-dir="LR"');
    expect(html).toContain('class="dag-dir" data-dir="TB" hidden');
    expect(html).toContain("data-dag-dir");
  });

  it("dag — minimap with viewport indicator and per-direction layers", () => {
    const html = renderHtml(withRun(stepSucceeded("ci/build", 100)));
    expect(html).toContain('id="dag-minimap"');
    expect(html).toContain('id="dag-mini-vp"');
    expect(html).toContain('class="dag-mini"');
  });

  it("dag — edges carry src/dst for hover highlighting", () => {
    const html = renderHtml(
      withRun(stepSucceeded("ci/build", 100), stepSucceeded("ci/test", 100)),
    );
    expect(html).toMatch(/class="edge" data-src="[^"]+" data-dst="[^"]+"/);
    expect(html).toContain("edge-hot");
    expect(html).toContain("node-lit");
  });

  it("list view — step stdout/stderr land in expandable rows", () => {
    const html = renderHtml([
      runStarted("run-1", "plan-abc"),
      {
        type: "step-failed",
        stepId: "ci/test",
        error: "exit 1",
        durationMs: 50,
        stdout: "out text here",
        stderr: "err text here",
        exitCode: 1,
      },
      runCompleted("run-1", "failure", 60),
    ]);
    expect(html).toContain("out text here");
    expect(html).toContain("err text here");
    expect(html).toContain("Exit code: 1");
  });
});
