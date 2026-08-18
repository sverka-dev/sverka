import { describe, it, expect } from "vitest";
import { Project, Entry, push, ComponentStep } from "@sverka/cdk";
import { pipelineV0 as pipeline, $, component, inputs } from "../index.js";

describe("component builder", () => {
  it("creates a ComponentStep with name, version, and inputs", () => {
    const proj = new Project("test");
    const ci = pipeline(proj, "ci", {
      steps: [
        (pip) => $`make build`.build(pip, "build"),
        (pip) =>
          component("deploy", "1.0.0", { env: "staging" })
            .dependsOn(["build"])
            .build(pip, "deploy-staging"),
      ],
    });
    const callStep = ci.node.children.find(
      (c) => c instanceof ComponentStep,
    ) as ComponentStep;
    expect(callStep).toBeInstanceOf(ComponentStep);
    expect(callStep.component.name).toBe("deploy");
    expect(callStep.component.version).toBe("1.0.0");
    expect(callStep.component.inputs.env).toBe("staging");
    expect(callStep.dependsOn).toEqual(["build"]);
  });

  it("with no inputs → empty object", () => {
    const proj = new Project("test");
    const ci = pipeline(proj, "ci", {
      steps: [
        (pip) => component("deploy", "1.0.0").build(pip, "deploy"),
      ],
    });
    const callStep = ci.node.children.find(
      (c) => c instanceof ComponentStep,
    ) as ComponentStep;
    expect(Object.keys(callStep.component.inputs)).toHaveLength(0);
  });

  it("accepts Reference values as inputs", () => {
    const proj = new Project("test");
    const ci = pipeline(proj, "ci", {
      steps: [
        (pip) =>
          component("deploy", "1.0.0", { env: inputs.env! }).build(pip, "deploy"),
      ],
    });
    const callStep = ci.node.children.find(
      (c) => c instanceof ComponentStep,
    ) as ComponentStep;
    expect(callStep.component.inputs.env).toEqual({
      kind: "context",
      namespace: "inputs",
      field: "env",
    });
  });
});
