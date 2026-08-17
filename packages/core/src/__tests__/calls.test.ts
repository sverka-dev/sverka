import { describe, it, expect } from "vitest";
import {
  Project,
  Pipeline,
  ShellStep,
  PipelineCallStep,
  Entry,
  push,
  type Reference,
} from "@sverka/cdk";
import { synthesize, SynthesisError } from "../index.js";

function makeTwoPipelineProject(calleeFirst = true): Project {
  const proj = new Project("myproj");
  const deploy = new Pipeline(proj, "deploy", {
    inputs: { env: { type: "string", required: true } },
  });
  new ShellStep(deploy, "deploy", {
    command: "deploy",
    outputs: { url: { type: "string" } },
  });

  const ci = new Pipeline(proj, "ci");
  new ShellStep(ci, "build", { command: "make build" });
  new PipelineCallStep(ci, "deploy-staging", {
    callee: "deploy",
    callInputs: { env: "staging" },
    dependsOn: ["build"],
  });
  new Entry(ci, "on-push", { trigger: push(), roots: ["build"] });

  // Order in tree doesn't matter for synthesis (two-pass), but test both.
  if (!calleeFirst) {
    // Re-create with reversed order — constructs lib doesn't reorder, so we
    // simulate by building a fresh project with ci first.
    const proj2 = new Project("myproj");
    const ci2 = new Pipeline(proj2, "ci");
    new ShellStep(ci2, "build", { command: "make build" });
    new PipelineCallStep(ci2, "deploy-staging", {
      callee: "deploy",
      callInputs: { env: "staging" },
      dependsOn: ["build"],
    });
    new Entry(ci2, "on-push", { trigger: push(), roots: ["build"] });
    const deploy2 = new Pipeline(proj2, "deploy", {
      inputs: { env: { type: "string", required: true } },
    });
    new ShellStep(deploy2, "deploy", {
      command: "deploy",
      outputs: { url: { type: "string" } },
    });
    return proj2;
  }
  return proj;
}

describe("synthesize — pipeline calls", () => {
  it("two-pipeline project: ci calls deploy; call step has call + callee outputs copied", () => {
    const proj = makeTwoPipelineProject(true);
    const graph = synthesize(proj);
    expect(graph.project.pipelines.length).toBe(2);

    const ci = graph.project.pipelines.find((p) => p.id === "ci")!;
    const deploy = graph.project.pipelines.find((p) => p.id === "deploy")!;

    const callStep = ci.steps.find((s) => s.id === "ci/deploy-staging")!;
    expect(callStep.call).toEqual({ callee: "deploy", inputs: { env: "staging" } });
    // Callee's outputs copied onto the call step.
    expect(callStep.outputs).toEqual([{ name: "url", type: "string" }]);
    // No shell operations on a call step.
    expect(callStep.operations).toEqual([]);

    // Callee pipeline is intact.
    expect(deploy.steps[0]?.id).toBe("deploy/deploy");
    expect(deploy.outputs[0]).toEqual({ name: "url", type: "string", stepId: "deploy/deploy" });
  });

  it("callee defined AFTER caller — two-pass resolves correctly", () => {
    const proj = makeTwoPipelineProject(false);
    const graph = synthesize(proj);
    const ci = graph.project.pipelines.find((p) => p.id === "ci")!;
    const callStep = ci.steps.find((s) => s.id === "ci/deploy-staging")!;
    expect(callStep.call?.callee).toBe("deploy");
    expect(callStep.outputs).toEqual([{ name: "url", type: "string" }]);
  });

  it("missing required input binding → MISSING_INPUT_BINDING", () => {
    const proj = new Project("myproj");
    new Pipeline(proj, "deploy", {
      inputs: { env: { type: "string", required: true } },
    });
    const ci = new Pipeline(proj, "ci");
    new PipelineCallStep(ci, "deploy-staging", { callee: "deploy" });
    expect(() => synthesize(proj)).toThrow(SynthesisError);
    try {
      synthesize(proj);
    } catch (err) {
      expect((err as SynthesisError).code).toBe("MISSING_INPUT_BINDING");
    }
  });

  it("unknown callee → UNKNOWN_CALLEE", () => {
    const proj = new Project("myproj");
    const ci = new Pipeline(proj, "ci");
    new PipelineCallStep(ci, "deploy-staging", { callee: "nonexistent" });
    expect(() => synthesize(proj)).toThrow(SynthesisError);
    try {
      synthesize(proj);
    } catch (err) {
      expect((err as SynthesisError).code).toBe("UNKNOWN_CALLEE");
    }
  });

  it("literal type mismatch → INPUT_TYPE_MISMATCH", () => {
    const proj = new Project("myproj");
    new Pipeline(proj, "deploy", {
      inputs: { env: { type: "string" } },
    });
    const ci = new Pipeline(proj, "ci");
    new PipelineCallStep(ci, "deploy-staging", {
      callee: "deploy",
      callInputs: { env: 42 }, // number bound to string input
    });
    expect(() => synthesize(proj)).toThrow(SynthesisError);
    try {
      synthesize(proj);
    } catch (err) {
      expect((err as SynthesisError).code).toBe("INPUT_TYPE_MISMATCH");
    }
  });

  it("binding to undeclared callee input → UNKNOWN_INPUT", () => {
    const proj = new Project("myproj");
    new Pipeline(proj, "deploy", {
      inputs: { env: { type: "string" } },
    });
    const ci = new Pipeline(proj, "ci");
    new PipelineCallStep(ci, "deploy-staging", {
      callee: "deploy",
      callInputs: { env: "staging", extra: "nope" },
    });
    expect(() => synthesize(proj)).toThrow(SynthesisError);
    try {
      synthesize(proj);
    } catch (err) {
      expect((err as SynthesisError).code).toBe("UNKNOWN_INPUT");
    }
  });

  it("call cycle (A calls B, B calls A) → CALL_CYCLE", () => {
    const proj = new Project("myproj");
    new Pipeline(proj, "a");
    new Pipeline(proj, "b");
    const a = new Pipeline(proj, "a2");
    new PipelineCallStep(a, "call-b", { callee: "b2" });
    const b = new Pipeline(proj, "b2");
    new PipelineCallStep(b, "call-a", { callee: "a2" });
    expect(() => synthesize(proj).project.pipelines).toThrow(SynthesisError);
    try {
      synthesize(proj);
    } catch (err) {
      expect((err as SynthesisError).code).toBe("CALL_CYCLE");
    }
  });

  it("nesting depth 5 → NESTING_TOO_DEEP; depth 4 → OK", () => {
    // 6-pipeline chain: p0→p1→p2→p3→p4→p5 — 5 call edges, exceeds max depth 4.
    const proj = new Project("myproj");
    for (let i = 0; i < 6; i++) {
      const p = new Pipeline(proj, `p${i}`);
      if (i < 5) {
        new PipelineCallStep(p, "call", { callee: `p${i + 1}` });
      }
    }
    expect(() => synthesize(proj)).toThrow(SynthesisError);
    try {
      synthesize(proj);
    } catch (err) {
      expect((err as SynthesisError).code).toBe("NESTING_TOO_DEEP");
    }

    // 5-pipeline chain: p0→p1→p2→p3→p4 — 4 call edges, exactly max depth 4, OK.
    const proj2 = new Project("ok");
    for (let i = 0; i < 5; i++) {
      const p = new Pipeline(proj2, `p${i}`);
      if (i < 4) {
        new PipelineCallStep(p, "call", { callee: `p${i + 1}` });
      }
    }
    expect(() => synthesize(proj2)).not.toThrow();
  });

  it("pipeline with entries AND called by another — graph preserves entries", () => {
    const proj = new Project("myproj");
    const deploy = new Pipeline(proj, "deploy", {
      inputs: { env: { type: "string", required: true } },
    });
    new ShellStep(deploy, "deploy", { command: "deploy" });
    new Entry(deploy, "on-manual", { trigger: push(), roots: ["deploy"] });

    const ci = new Pipeline(proj, "ci");
    new ShellStep(ci, "build", { command: "make build" });
    new PipelineCallStep(ci, "deploy-staging", {
      callee: "deploy",
      callInputs: { env: "staging" },
      dependsOn: ["build"],
    });
    new Entry(ci, "on-push", { trigger: push(), roots: ["build"] });

    const graph = synthesize(proj);
    const deployGraph = graph.project.pipelines.find((p) => p.id === "deploy")!;
    expect(deployGraph.entries.length).toBe(1);
    expect(deployGraph.entries[0]?.trigger.kind).toBe("push");
  });

  it("existing single-pipeline synthesis still passes (backward compat)", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    new ShellStep(pipeline, "build", { command: "npm run build" });
    new Entry(pipeline, "on-push", { trigger: push(), roots: ["build"] });
    const graph = synthesize(proj);
    expect(graph.project.pipelines.length).toBe(1);
    expect(graph.project.pipelines[0]?.steps[0]?.id).toBe("ci/build");
  });
});
