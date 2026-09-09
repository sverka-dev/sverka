import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { createHtmlRenderer } from "../src/html-renderer.js";
import {
  runStarted, stepSucceeded, stepFailed,
  stepSkipped, runCompleted,
} from "./helpers/fixtures.js";
import type { Finding, PolicyResult } from "@sverka/verification";
import type { DefinitionGraph } from "@sverka/workflow";

function makeFinding(severity: string, checkId: string, file = "src/index.ts"): Finding {
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
  rules: [{ ruleIndex: 0, triggered: true, matched: [makeFinding("high", "ci/lint")] }],
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
          { id: "ci/build", runtime: { kind: "host" }, operations: [{ kind: "shell", command: "echo" }], inputs: [], outputs: [], dependencies: [] },
          { id: "ci/test", runtime: { kind: "host" }, operations: [{ kind: "shell", command: "echo" }], inputs: [], outputs: [], dependencies: [{ kind: "control", producer: "ci/build" }] },
        ],
      },
    ],
  },
};

let tmpDir: string;

beforeEach(async () => {
  tmpDir = join(process.cwd(), ".test-tmp-html", `test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

/** Create a renderer, emit events, flush, and return the generated HTML. */
function renderHtml(events: Parameters<ReturnType<typeof createHtmlRenderer>["onEvent"]>[0][]): string {
  const outputPath = join(tmpDir, "report.html");
  const renderer = createHtmlRenderer({ outputPath, graph: SAMPLE_GRAPH });
  for (const event of events) renderer.onEvent(event);
  renderer.flush();
  return readFileSync(outputPath, "utf-8");
}

/** Common event sequence: run started + completed with optional extra events. */
function withRun(...extra: Parameters<ReturnType<typeof createHtmlRenderer>["onEvent"]>[0][]): Parameters<ReturnType<typeof createHtmlRenderer>["onEvent"]>[0][] {
  return [runStarted("run-1", "plan-abc"), ...extra, runCompleted("run-1", "success", 100)];
}

describe("HtmlRenderer", () => {
  it("9. flush produces HTML with DOCTYPE, title, header, sections", () => {
    const html = renderHtml(withRun(stepSucceeded("ci/build", 100)));
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>");
    expect(html).toContain("<header");
    expect(html).toContain('id="dag"');
    expect(html).toContain('id="findings"');
    expect(html).toContain('id="steps"');
  });

  it("10. run summary contains planId, status, duration", () => {
    const html = renderHtml([runStarted("run-1", "plan-abc"), runCompleted("run-1", "success", 560)]);
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
    renderer.onFindings([makeFinding("high", "ci/lint"), makeFinding("medium", "ci/test")]);
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

  it("18. ReactFlow CDN — HTML includes ReactFlow script tag", () => {
    const html = renderHtml(withRun());
    expect(html).toContain("reactflow");
    expect(html).toContain("<script");
  });

  it("19. filter JS — HTML contains vanilla JS for findings filter/sort/search", () => {
    const outputPath = join(tmpDir, "report.html");
    const renderer = createHtmlRenderer({ outputPath, graph: SAMPLE_GRAPH });
    renderer.onEvent(runStarted("run-1", "plan-abc"));
    renderer.onEvent(runCompleted("run-1", "success", 100));
    renderer.onFindings([makeFinding("high", "ci/lint"), makeFinding("medium", "ci/test")]);
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
});
