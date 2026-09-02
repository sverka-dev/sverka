import { describe, it, expect } from "vitest";
import { synthesize, Project, Pipeline } from "@sverka/workflow";
import { compileTemporal, TemporalTarget, TemporalTargetError } from "../index.js";
import { makeGraph, makeSimpleGraph, makeGraphWithDeps, makeDiamondGraph, expectDiagnostic } from "../../__tests__/helpers/graphs.js";

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
    const result = compileTemporal(makeGraph({
      entryId: "on-schedule",
      trigger: { kind: "schedule", cron: "0 * * * *" },
      steps: [{ id: "build", command: "echo hi" }],
    }));
    const wf = result.artifacts[0]!.content;
    expect(wf).toContain("Trigger: schedule");
    expect(wf).toContain("0 * * * *");
  });

  it("push trigger → unsupported diagnostic", () => {
    const result = compileTemporal(makeGraph({
      entryId: "on-push",
      trigger: { kind: "push" },
      steps: [{ id: "build", command: "echo hi" }],
    }));
    expectDiagnostic(result.diagnostics, "trigger.push");
  });
});

describe("compileTemporal — retry and timeout", () => {
  it("RetryPolicy → activity retry config in lowered graph", () => {
    const graph = makeGraph({ steps: [{ id: "build", command: "echo hi", retry: { max: 5 } }] });
    const target = new TemporalTarget();
    const lowered = target.lower(graph);
    const activity = lowered.workflows[0]!.activities.find((a) => a.stepId === "ci/build");
    expect(activity?.retry?.max).toBe(5);
  });

  it("RetryPolicy → retry config in emitted workflow code", () => {
    const result = compileTemporal(makeGraph({ steps: [{ id: "build", command: "echo hi", retry: { max: 5 } }] }));
    const wf = result.artifacts[0]!.content;
    expect(wf).toContain("retry");
    expect(wf).toContain("6");
  });

  it("Timeout → activity timeout in lowered graph", () => {
    const graph = makeGraph({ steps: [{ id: "build", command: "echo hi", timeout: 30000 }] });
    const target = new TemporalTarget();
    const lowered = target.lower(graph);
    const activity = lowered.workflows[0]!.activities.find((a) => a.stepId === "ci/build");
    expect(activity?.timeoutMs).toBe(30000);
  });

  it("Timeout → startToCloseTimeout in emitted workflow code", () => {
    const result = compileTemporal(makeGraph({ steps: [{ id: "build", command: "echo hi", timeout: 30000 }] }));
    const wf = result.artifacts[0]!.content;
    expect(wf).toContain("startToCloseTimeout");
    expect(wf).toContain("30");
  });
});

describe("compileTemporal — conditions", () => {
  it("condition status:failure → if (_failed) in workflow body", () => {
    const result = compileTemporal(makeGraph({
      steps: [
        { id: "build", command: "echo hi" },
        { id: "notify", command: "echo failed", condition: { kind: "status", status: "failure" }, dependsOn: ["build"] },
      ],
      roots: ["notify"],
    }));
    const wf = result.artifacts[0]!.content;
    expect(wf).toContain("if (_failed)");
  });

  it("condition status:never → if (false) in workflow body", () => {
    const result = compileTemporal(makeGraph({
      steps: [{ id: "build", command: "echo hi", condition: { kind: "status", status: "never" } }],
    }));
    const wf = result.artifacts[0]!.content;
    expect(wf).toContain("if (false)");
  });
});

describe("compileTemporal — identifier validation", () => {
  it("entry ID starting with digit → prefixed with underscore", () => {
    const result = compileTemporal(makeGraph({
      entryId: "1on-manual",
      steps: [{ id: "build", command: "echo hi" }],
    }));
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
