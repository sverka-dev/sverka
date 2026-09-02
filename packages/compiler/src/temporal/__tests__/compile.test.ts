import { describe, it, expect } from "vitest";
import { Project, Pipeline, ShellStep, Entry, type DefinitionGraph } from "@sverka/workflow";
import { synthesize } from "@sverka/workflow";
import { compileTemporal, TemporalTarget, TemporalTargetError } from "../index.js";

function makeSimpleGraph(): DefinitionGraph {
  const proj = new Project("test");
  const p = new Pipeline(proj, "ci");
  new ShellStep(p, "build", { command: "bun run build" });
  new Entry(p, "on-manual", { trigger: { kind: "manual" }, roots: ["build"] });
  return synthesize(proj);
}

function makeGraphWithDeps(): DefinitionGraph {
  const proj = new Project("test");
  const p = new Pipeline(proj, "ci");
  new ShellStep(p, "lint", { command: "bun run lint" });
  new ShellStep(p, "build", { command: "bun run build", dependsOn: ["lint"] });
  new Entry(p, "on-manual", { trigger: { kind: "manual" }, roots: ["build"] });
  return synthesize(proj);
}

function makeDiamondGraph(): DefinitionGraph {
  const proj = new Project("test");
  const p = new Pipeline(proj, "ci");
  new ShellStep(p, "lint", { command: "bun run lint" });
  new ShellStep(p, "test", { command: "bun run test" });
  new ShellStep(p, "build", { command: "bun run build", dependsOn: ["lint", "test"] });
  new Entry(p, "on-manual", { trigger: { kind: "manual" }, roots: ["build"] });
  return synthesize(proj);
}

describe("compileTemporal — basic", () => {
  it("produces two TypeScript artifacts", () => {
    const result = compileTemporal(makeSimpleGraph());
    expect(result.artifacts).toHaveLength(2);
    expect(result.artifacts[0]?.path).toBe("ci.workflow.ts");
    expect(result.artifacts[1]?.path).toBe("ci.activities.ts");
  });

  it("workflow file imports temporalio/workflow", () => {
    const result = compileTemporal(makeSimpleGraph());
    const wf = result.artifacts[0]!.content;
    expect(wf).toContain('import { proxyActivities } from "@temporalio/workflow"');
  });

  it("activities file exports runStep function", () => {
    const result = compileTemporal(makeSimpleGraph());
    const acts = result.artifacts[1]!.content;
    expect(acts).toContain("export async function runStep");
  });
});

describe("compileTemporal — activity sequencing", () => {
  it("single-step graph → one activity call", () => {
    const result = compileTemporal(makeSimpleGraph());
    const wf = result.artifacts[0]!.content;
    expect(wf).toContain('await runStep("ci/build")');
  });

  it("two-step graph with dependency → sequential awaits", () => {
    const result = compileTemporal(makeGraphWithDeps());
    const wf = result.artifacts[0]!.content;
    const lintIdx = wf.indexOf('await runStep("ci/lint")');
    const buildIdx = wf.indexOf('await runStep("ci/build")');
    expect(lintIdx).toBeGreaterThan(-1);
    expect(buildIdx).toBeGreaterThan(-1);
    expect(lintIdx).toBeLessThan(buildIdx);
  });

  it("diamond dependency → correct await ordering (producers first)", () => {
    const result = compileTemporal(makeDiamondGraph());
    const wf = result.artifacts[0]!.content;
    const lintIdx = wf.indexOf('await runStep("ci/lint")');
    const testIdx = wf.indexOf('await runStep("ci/test")');
    const buildIdx = wf.indexOf('await runStep("ci/build")');
    expect(lintIdx).toBeGreaterThan(-1);
    expect(testIdx).toBeGreaterThan(-1);
    expect(buildIdx).toBeGreaterThan(-1);
    expect(lintIdx).toBeLessThan(buildIdx);
    expect(testIdx).toBeLessThan(buildIdx);
  });
});

describe("compileTemporal — triggers", () => {
  it("manual trigger → workflow with manual trigger comment", () => {
    const result = compileTemporal(makeSimpleGraph());
    const wf = result.artifacts[0]!.content;
    expect(wf).toContain("Trigger: manual");
  });

  it("schedule trigger → workflow with schedule trigger and cron", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi" });
    new Entry(p, "on-schedule", { trigger: { kind: "schedule", cron: "0 * * * *" }, roots: ["build"] });
    const result = compileTemporal(synthesize(proj));
    const wf = result.artifacts[0]!.content;
    expect(wf).toContain("Trigger: schedule");
    expect(wf).toContain("0 * * * *");
  });

  it("push trigger → unsupported diagnostic", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi" });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileTemporal(synthesize(proj));
    expect(result.diagnostics.some((d) => d.capability === "trigger.push")).toBe(true);
  });
});

describe("compileTemporal — retry and timeout", () => {
  it("RetryPolicy → activity retry config in lowered graph", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi", retry: { max: 5 } });
    new Entry(p, "on-manual", { trigger: { kind: "manual" }, roots: ["build"] });
    const result = compileTemporal(synthesize(proj));
    // The retry config is in the lowered graph; verify via the target graph
    const target = new TemporalTarget();
    const graph = target.lower(synthesize(proj));
    const activity = graph.workflows[0]!.activities.find((a) => a.stepId === "ci/build");
    expect(activity?.retry?.max).toBe(5);
  });

  it("RetryPolicy → retry config in emitted workflow code", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi", retry: { max: 5 } });
    new Entry(p, "on-manual", { trigger: { kind: "manual" }, roots: ["build"] });
    const result = compileTemporal(synthesize(proj));
    const wf = result.artifacts[0]!.content;
    expect(wf).toContain("retry");
    expect(wf).toContain("5");
  });

  it("Timeout → activity timeout in lowered graph", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi", timeout: 30000 });
    new Entry(p, "on-manual", { trigger: { kind: "manual" }, roots: ["build"] });
    const target = new TemporalTarget();
    const graph = target.lower(synthesize(proj));
    const activity = graph.workflows[0]!.activities.find((a) => a.stepId === "ci/build");
    expect(activity?.timeoutMs).toBe(30000);
  });

  it("Timeout → startToCloseTimeout in emitted workflow code", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi", timeout: 30000 });
    new Entry(p, "on-manual", { trigger: { kind: "manual" }, roots: ["build"] });
    const result = compileTemporal(synthesize(proj));
    const wf = result.artifacts[0]!.content;
    expect(wf).toContain("startToCloseTimeout");
    expect(wf).toContain("30");
  });
});

describe("compileTemporal — conditions", () => {
  it("condition status:failure → if (_failed) in workflow body", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi" });
    new ShellStep(p, "notify", {
      command: "echo failed",
      condition: { kind: "status", status: "failure" },
      dependsOn: ["build"],
    });
    new Entry(p, "on-manual", { trigger: { kind: "manual" }, roots: ["notify"] });
    const result = compileTemporal(synthesize(proj));
    const wf = result.artifacts[0]!.content;
    expect(wf).toContain("if (_failed)");
  });

  it("condition status:never → if (false) in workflow body", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "echo hi",
      condition: { kind: "status", status: "never" },
    });
    new Entry(p, "on-manual", { trigger: { kind: "manual" }, roots: ["build"] });
    const result = compileTemporal(synthesize(proj));
    const wf = result.artifacts[0]!.content;
    expect(wf).toContain("if (false)");
  });
});

describe("compileTemporal — identifier validation", () => {
  it("entry ID starting with digit → prefixed with underscore", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi" });
    new Entry(p, "1on-manual", { trigger: { kind: "manual" }, roots: ["build"] });
    const result = compileTemporal(synthesize(proj));
    const wf = result.artifacts[0]!.content;
    expect(wf).toContain("_1on_manual");
  });
});

describe("compileTemporal — errors", () => {
  it("throws INVALID_GRAPH for empty graph", () => {
    const proj = new Project("test");
    new Pipeline(proj, "ci");
    expect(() => compileTemporal(synthesize(proj))).toThrow(TemporalTargetError);
    expect(() => compileTemporal(synthesize(proj))).toThrow(/no root pipelines/);
  });
});

describe("compileTemporal — determinism", () => {
  it("same graph → identical output", () => {
    const r1 = compileTemporal(makeSimpleGraph());
    const r2 = compileTemporal(makeSimpleGraph());
    expect(r1.artifacts[0]?.content).toBe(r2.artifacts[0]?.content);
    expect(r1.artifacts[1]?.content).toBe(r2.artifacts[1]?.content);
  });
});

describe("compileTemporal — TemporalTarget class", () => {
  it("exposes name and capabilities", () => {
    const target = new TemporalTarget();
    expect(target.name).toBe("temporal");
    expect(target.capabilities["trigger.manual"]).toBe("native");
    expect(target.capabilities["trigger.push"]).toBe("unsupported");
  });

  it("honors namespace and taskQueue config", () => {
    const result = compileTemporal(makeSimpleGraph(), { namespace: "prod", taskQueue: "my-queue" });
    const wf = result.artifacts[0]!.content;
    expect(wf).toContain("my-queue");
  });
});
