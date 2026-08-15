import { describe, it, expect } from "vitest";
import { Project, Entry, push, PipelineCallStep } from "@sverka/constructs";
import { pipelineV0 as pipeline, sh, callPipeline, inputs } from "../index.js";

describe("callPipeline builder", () => {
  it("creates a PipelineCallStep with callee and callInputs", () => {
    const proj = new Project("test");
    const ci = pipeline(proj, "ci", {
      steps: [
        (pip) => sh`make build`.build(pip, "build"),
        (pip) =>
          callPipeline("deploy", { env: "staging" })
            .dependsOn(["build"])
            .build(pip, "deploy-staging"),
      ],
    });
    const callStep = ci.node.children.find(
      (c) => c instanceof PipelineCallStep,
    ) as PipelineCallStep;
    expect(callStep).toBeInstanceOf(PipelineCallStep);
    expect(callStep.callee).toBe("deploy");
    expect(callStep.callInputs.get("env")).toBe("staging");
    expect(callStep.dependsOn).toEqual(["build"]);
  });

  it("with no callInputs → empty map", () => {
    const proj = new Project("test");
    const ci = pipeline(proj, "ci", {
      steps: [
        (pip) => callPipeline("deploy").build(pip, "deploy"),
      ],
    });
    const callStep = ci.node.children.find(
      (c) => c instanceof PipelineCallStep,
    ) as PipelineCallStep;
    expect(callStep.callInputs.size).toBe(0);
  });

  it("accepts Reference values as callInputs (e.g. inputs.env context ref)", () => {
    const proj = new Project("test");
    const ci = pipeline(proj, "ci", {
      steps: [
        (pip) =>
          callPipeline("deploy", { env: inputs.env! }).build(pip, "deploy"),
      ],
    });
    const callStep = ci.node.children.find(
      (c) => c instanceof PipelineCallStep,
    ) as PipelineCallStep;
    const envBinding = callStep.callInputs.get("env");
    expect(envBinding).toEqual({ kind: "context", namespace: "inputs", field: "env" });
  });

  it("full two-pipeline project synthesizes correctly", () => {
    const proj = new Project("test");
    // Callee pipeline.
    pipeline(proj, "deploy", {
      inputs: { env: { type: "string", required: true } },
      steps: [
        (pip) => sh`deploy ${inputs.env!}`.outputs({ url: { type: "string" } }).build(pip, "deploy"),
      ],
    });
    // Caller pipeline.
    pipeline(proj, "ci", {
      steps: [
        (pip) => sh`make build`.build(pip, "build"),
        (pip) =>
          callPipeline("deploy", { env: "staging" })
            .dependsOn(["build"])
            .build(pip, "deploy-staging"),
      ],
      entries: [
        (pip) => new Entry(pip, "on-push", { trigger: push(), roots: ["build"] }),
      ],
    });

    // Just verify the construct tree is valid — synthesis is tested in core.
    const ciPipeline = proj.node.children.find((c) => c.node.id === "ci")!;
    const callStep = ciPipeline.node.children.find(
      (c) => c instanceof PipelineCallStep,
    ) as PipelineCallStep;
    expect(callStep.callee).toBe("deploy");
  });
});
