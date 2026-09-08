import { describe, it, expect } from "vitest";
import { createTextRenderer } from "../src/text-renderer.js";
import { MockWriter } from "./helpers/fixtures.js";
import {
  runStarted, stepPending, stepStarted, stepSucceeded, stepFailed,
  stepSkipped, runCompleted,
} from "./helpers/fixtures.js";
import type { Finding, PolicyResult } from "@sverka/verification";

function makeFinding(severity: string, checkId: string): Finding {
  return {
    id: `${checkId}:fp-${severity}`,
    fingerprint: `fp-${severity}`,
    checkId,
    severity: severity as Finding["severity"],
    confidence: 0.5,
    message: "test",
    rule: "rule-1",
    file: "src/index.ts",
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
  triggered: [
    { finding: makeFinding("high", "ci/lint"), ruleIndex: 0 },
  ],
  rules: [
    { ruleIndex: 0, triggered: true, matched: [makeFinding("high", "ci/lint")] },
  ],
  summary: "fail: 1 finding triggered 1 rule (1 high)",
};

describe("TextRenderer", () => {
  it("produces step status lines with stepId and duration", () => {
    const writer = new MockWriter();
    const renderer = createTextRenderer({ writer });

    renderer.onEvent(runStarted("run-1", "plan-abc"));
    renderer.onEvent(stepPending("ci/lint"));
    renderer.onEvent(stepStarted("ci/lint"));
    renderer.onEvent(stepSucceeded("ci/lint", 120));

    const text = writer.text;
    expect(text).toContain("run started");
    expect(text).toContain("ci/lint");
    expect(text).toContain("succeeded");
    expect(text).toContain("120ms");
  });

  it("produces failed step line with error", () => {
    const writer = new MockWriter();
    const renderer = createTextRenderer({ writer });

    renderer.onEvent(stepFailed("ci/test", "exit code 1", 340));
    const text = writer.text;
    expect(text).toContain("ci/test");
    expect(text).toContain("failed");
    expect(text).toContain("340ms");
    expect(text).toContain("exit code 1");
  });

  it("produces run completed line with status", () => {
    const writer = new MockWriter();
    const renderer = createTextRenderer({ writer });

    renderer.onEvent(runCompleted("run-1", "success", 560));
    expect(writer.text).toContain("run completed");
    expect(writer.text).toContain("success");
    expect(writer.text).toContain("560ms");
  });

  it("produces findings summary with counts by severity and checkId", () => {
    const writer = new MockWriter();
    const renderer = createTextRenderer({ writer });

    const findings = [
      makeFinding("high", "ci/lint"),
      makeFinding("high", "ci/lint"),
      makeFinding("medium", "ci/test"),
    ];
    renderer.onFindings(findings);

    const text = writer.text;
    expect(text).toContain("Findings (3 total)");
    expect(text).toContain("high");
    expect(text).toContain("2");
    expect(text).toContain("ci/lint");
  });

  it("produces policy verdict line", () => {
    const writer = new MockWriter();
    const renderer = createTextRenderer({ writer });

    renderer.onFindings([makeFinding("high", "ci/lint")]);
    renderer.onVerdict(FAIL_RESULT);

    const text = writer.text;
    expect(text).toContain("Policy: FAIL");
  });

  it("omits findings and verdict sections when onFindings not called", () => {
    const writer = new MockWriter();
    const renderer = createTextRenderer({ writer });

    renderer.onEvent(runStarted("run-1", "plan-abc"));
    renderer.onEvent(stepSucceeded("ci/lint", 100));
    renderer.onEvent(runCompleted("run-1", "success", 200));
    renderer.flush();

    const text = writer.text;
    expect(text).not.toContain("Findings");
    expect(text).not.toContain("Policy:");
  });

  it("flush is a no-op (text renderer writes immediately)", () => {
    const writer = new MockWriter();
    const renderer = createTextRenderer({ writer });

    renderer.onEvent(stepSucceeded("ci/lint", 100));
    const beforeFlush = writer.lines.length;
    renderer.flush();
    expect(writer.lines.length).toBe(beforeFlush);
  });

  it("onVerdict without onFindings is ignored", () => {
    const writer = new MockWriter();
    const renderer = createTextRenderer({ writer });

    renderer.onVerdict(PASS_RESULT);
    expect(writer.text).not.toContain("Policy:");
  });
});
