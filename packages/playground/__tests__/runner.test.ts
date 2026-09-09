import { describe, it, expect } from "vitest";
import { Project, Pipeline, FunctionStep, Entry, runPipeline } from "../src/index.js";

describe("runPipeline", () => {
  it("runs a simple pipeline with one FunctionStep", async () => {
    const proj = new Project("test");
    const checks = new Pipeline(proj, "checks");

    new FunctionStep(checks, "lint", {
      fn: () => [
        { rule: "no-unused-vars", file: "src/index.ts", line: 5, severity: "high" as const, message: "x is unused" },
      ],
    });

    new Entry(checks, "on-push", { trigger: { kind: "push" }, roots: ["lint"] });

    const result = await runPipeline(proj);
    expect(result.success).toBe(true);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].rule).toBe("no-unused-vars");
    expect(result.findings[0].file).toBe("src/index.ts");
    expect(result.findings[0].startLine).toBe(5);
    expect(result.findings[0].severity).toBe("high");
    expect(result.findings[0].checkId).toBe("lint");
    expect(result.findings[0].id).toContain("lint:");
    expect(result.findings[0].fingerprint).toBeTruthy();
  });

  it("runs multiple steps and collects all findings", async () => {
    const proj = new Project("test");
    const checks = new Pipeline(proj, "checks");

    new FunctionStep(checks, "lint", {
      fn: () => [
        { rule: "no-unused-vars", file: "a.ts", line: 1, severity: "high" as const, message: "unused" },
        { rule: "no-console", file: "b.ts", line: 3, severity: "medium" as const, message: "console.log" },
      ],
    });

    new FunctionStep(checks, "typecheck", {
      fn: () => [
        { rule: "ts2322", file: "c.ts", line: 10, severity: "critical" as const, message: "type error" },
      ],
    });

    const result = await runPipeline(proj);
    expect(result.findings).toHaveLength(3);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].findings).toHaveLength(2);
    expect(result.steps[1].findings).toHaveLength(1);
  });

  it("handles async function steps", async () => {
    const proj = new Project("test");
    const checks = new Pipeline(proj, "checks");

    new FunctionStep(checks, "async-check", {
      fn: async () => {
        await new Promise((r) => setTimeout(r, 10));
        return [
          { rule: "async-rule", file: "x.ts", line: 1, severity: "low" as const, message: "async finding" },
        ];
      },
    });

    const result = await runPipeline(proj);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].rule).toBe("async-rule");
  });

  it("handles step errors gracefully", async () => {
    const proj = new Project("test");
    const checks = new Pipeline(proj, "checks");

    new FunctionStep(checks, "failing", {
      fn: () => {
        throw new Error("step crashed");
      },
    });

    new FunctionStep(checks, "passing", {
      fn: () => [
        { rule: "ok", file: "ok.ts", line: 1, severity: "info" as const, message: "fine" },
      ],
    });

    const result = await runPipeline(proj);
    expect(result.success).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.steps[0].status).toBe("failure");
    expect(result.steps[0].error).toBe("step crashed");
    expect(result.steps[1].status).toBe("success");
  });

  it("handles empty pipeline", async () => {
    const proj = new Project("test");
    new Pipeline(proj, "empty");
    const result = await runPipeline(proj);
    expect(result.findings).toHaveLength(0);
    expect(result.success).toBe(true);
  });

  it("generates stable fingerprints for same finding", async () => {
    const proj1 = new Project("test1");
    const checks1 = new Pipeline(proj1, "checks");
    new FunctionStep(checks1, "lint", {
      fn: () => [
        { rule: "r1", file: "f.ts", line: 1, severity: "high" as const, message: "m" },
      ],
    });

    const proj2 = new Project("test2");
    const checks2 = new Pipeline(proj2, "checks");
    new FunctionStep(checks2, "lint", {
      fn: () => [
        { rule: "r1", file: "f.ts", line: 1, severity: "high" as const, message: "m" },
      ],
    });

    const r1 = await runPipeline(proj1);
    const r2 = await runPipeline(proj2);
    expect(r1.findings[0].fingerprint).toBe(r2.findings[0].fingerprint);
    expect(r1.findings[0].id).toBe(r2.findings[0].id);
  });

  it("uses custom tool name when provided", async () => {
    const proj = new Project("test");
    const checks = new Pipeline(proj, "checks");
    new FunctionStep(checks, "eslint", {
      fn: () => [
        { rule: "r1", file: "f.ts", line: 1, severity: "high" as const, message: "m", tool: "eslint" },
      ],
    });

    const result = await runPipeline(proj);
    expect(result.findings[0].source.tool).toBe("eslint");
  });

  it("uses step id as tool name when not provided", async () => {
    const proj = new Project("test");
    const checks = new Pipeline(proj, "checks");
    new FunctionStep(checks, "my-check", {
      fn: () => [
        { rule: "r1", file: "f.ts", line: 1, severity: "high" as const, message: "m" },
      ],
    });

    const result = await runPipeline(proj);
    expect(result.findings[0].source.tool).toBe("my-check");
  });

  it("tracks duration", async () => {
    const proj = new Project("test");
    const checks = new Pipeline(proj, "checks");
    new FunctionStep(checks, "slow", {
      fn: async () => {
        await new Promise((r) => setTimeout(r, 50));
        return [{ rule: "r", file: "f.ts", line: 1, severity: "low" as const, message: "m" }];
      },
    });

    const result = await runPipeline(proj);
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(40);
    expect(result.steps[0].durationMs).toBeGreaterThanOrEqual(40);
  });
});
