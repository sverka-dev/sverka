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
import { synthesize, expandPipelineCalls, type StepDefinition } from "../index.js";

describe("expandPipelineCalls", () => {
  it("ci calls deploy (1 step) → expansion yields ci/build, ci/deploy-staging/deploy", () => {
    const proj = new Project("myproj");
    const deploy = new Pipeline(proj, "deploy", {
      inputs: { env: { type: "string", required: true } },
    });
    new ShellStep(deploy, "deploy", { command: "deploy" });
    const ci = new Pipeline(proj, "ci");
    new ShellStep(ci, "build", { command: "make build" });
    new PipelineCallStep(ci, "deploy-staging", {
      callee: "deploy",
      callInputs: { env: "staging" },
      dependsOn: ["build"],
    });

    const graph = synthesize(proj);
    const ciPipeline = graph.project.pipelines.find((p) => p.id === "ci")!;
    const expanded = expandPipelineCalls(graph, ciPipeline.steps);

    const ids = expanded.map((s) => s.id);
    expect(ids).toContain("ci/build");
    expect(ids).toContain("ci/deploy-staging/deploy");
    expect(ids.find((id) => id === "ci/deploy-staging")).toBeUndefined();
  });

  it("callee inputs.env bound to caller literal → expanded step has no inputs.env ref", () => {
    const proj = new Project("myproj");
    const deploy = new Pipeline(proj, "deploy", {
      inputs: { env: { type: "string", required: true } },
    });
    // The callee step references inputs.env as a context ref.
    new ShellStep(deploy, "deploy", {
      command: "deploy",
      inputs: [{ kind: "context", namespace: "inputs", field: "env" }],
    });
    const ci = new Pipeline(proj, "ci");
    new ShellStep(ci, "build", { command: "make build" });
    new PipelineCallStep(ci, "deploy-staging", {
      callee: "deploy",
      callInputs: { env: "staging" },
      dependsOn: ["build"],
    });

    const graph = synthesize(proj);
    const ciPipeline = graph.project.pipelines.find((p) => p.id === "ci")!;
    const expanded = expandPipelineCalls(graph, ciPipeline.steps);

    const deployStep = expanded.find((s) => s.id === "ci/deploy-staging/deploy")!;
    // The inputs.env context ref should be dropped (literal binding).
    expect(deployStep.inputs).toEqual([]);
  });

  it("callee inputs.env bound to caller StepRef → expanded callee step depends on ci/build", () => {
    const proj = new Project("myproj");
    const deploy = new Pipeline(proj, "deploy", {
      inputs: { version: { type: "string", required: true } },
    });
    new ShellStep(deploy, "deploy", {
      command: "deploy",
      inputs: [{ kind: "context", namespace: "inputs", field: "version" }],
    });
    const ci = new Pipeline(proj, "ci");
    new ShellStep(ci, "build", {
      command: "make build",
      outputs: { version: { type: "string" } },
    });
    new PipelineCallStep(ci, "deploy-staging", {
      callee: "deploy",
      callInputs: {
        version: { kind: "step", step: "build", output: "version", type: "string" },
      },
      dependsOn: ["build"],
    });

    const graph = synthesize(proj);
    const ciPipeline = graph.project.pipelines.find((p) => p.id === "ci")!;
    const expanded = expandPipelineCalls(graph, ciPipeline.steps);

    const deployStep = expanded.find((s) => s.id === "ci/deploy-staging/deploy")!;
    // The inputs.version context ref should be replaced with a StepRef to ci/build.
    expect(deployStep.inputs).toContainEqual({
      kind: "step",
      step: "ci/build",
      output: "version",
      type: "string",
    });
  });

  it("downstream caller step referencing call step output → rewritten to callee producer", () => {
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
    // A downstream step that references the call step's output.
    new ShellStep(ci, "notify", {
      command: "notify",
      dependsOn: ["deploy-staging"],
      inputs: [{ kind: "step", step: "ci/deploy-staging", output: "url", type: "string" }],
    });

    const graph = synthesize(proj);
    const ciPipeline = graph.project.pipelines.find((p) => p.id === "ci")!;
    const expanded = expandPipelineCalls(graph, ciPipeline.steps);

    const notifyStep = expanded.find((s) => s.id === "ci/notify")!;
    // The StepRef to ci/deploy-staging:url should be rewritten to ci/deploy-staging/deploy:url.
    expect(notifyStep.inputs).toContainEqual({
      kind: "step",
      step: "ci/deploy-staging/deploy",
      output: "url",
      type: "string",
    });
  });

  it("nested calls (A calls B calls C) → fully flattened", () => {
    const proj = new Project("myproj");
    const c = new Pipeline(proj, "c");
    new ShellStep(c, "step-c", { command: "echo c" });
    const b = new Pipeline(proj, "b");
    new ShellStep(b, "step-b", { command: "echo b" });
    new PipelineCallStep(b, "call-c", { callee: "c" });
    const a = new Pipeline(proj, "a");
    new ShellStep(a, "step-a", { command: "echo a" });
    new PipelineCallStep(a, "call-b", { callee: "b", dependsOn: ["step-a"] });

    const graph = synthesize(proj);
    const aPipeline = graph.project.pipelines.find((p) => p.id === "a")!;
    const expanded = expandPipelineCalls(graph, aPipeline.steps);

    const ids = expanded.map((s) => s.id).sort();
    expect(ids).toEqual(
      ["a/step-a", "a/call-b/step-b", "a/call-b/call-c/step-c"].sort(),
    );
  });

  it("expansion of a graph with no calls → identity", () => {
    const proj = new Project("myproj");
    const ci = new Pipeline(proj, "ci");
    new ShellStep(ci, "build", { command: "make build" });
    new ShellStep(ci, "test", { command: "make test", dependsOn: ["build"] });

    const graph = synthesize(proj);
    const ciPipeline = graph.project.pipelines.find((p) => p.id === "ci")!;
    const expanded = expandPipelineCalls(graph, ciPipeline.steps);

    expect(expanded.length).toBe(2);
    expect(expanded.map((s) => s.id)).toEqual(["ci/build", "ci/test"]);
  });
});
