import { describe, it, expect } from "vitest";
import { Project, Pipeline } from "@sverka/workflow";
import { $, matrixContext } from "../index.js";

describe("StepBuilder.matrix()", () => {
  it("sets matrix spec on the built ShellStep", () => {
    const project = new Project("sdk-matrix");
    const pipeline = new Pipeline(project, "ci");
    const step = $`make test`.matrix({ dimensions: { node: [18, 20] } }).build(pipeline, "test");
    expect(step.matrix).toEqual({ dimensions: { node: [18, 20] } });
  });

  it("is chainable with other builders", () => {
    const project = new Project("sdk-chain");
    const pipeline = new Pipeline(project, "ci");
    const step = $`make test`
      .matrix({ dimensions: { node: [18, 20], os: ["ubuntu"] } })
      .timeout(60000)
      .build(pipeline, "test");
    expect(step.matrix?.dimensions.node).toEqual([18, 20]);
    expect(step.matrix?.dimensions.os).toEqual(["ubuntu"]);
    expect(step.timeout).toBe(60000);
  });

  it("matrix is undefined when .matrix() not called", () => {
    const project = new Project("sdk-no-matrix");
    const pipeline = new Pipeline(project, "ci");
    const step = $`make test`.build(pipeline, "test");
    expect(step.matrix).toBeUndefined();
  });
});

describe("matrix context namespace", () => {
  it("creates a ContextRef for matrix.node", () => {
    const ref = matrixContext.node;
    expect(ref).toEqual({ kind: "context", namespace: "matrix", field: "node" });
  });

  it("creates a ContextRef for matrix.os", () => {
    const ref = matrixContext.os;
    expect(ref).toEqual({ kind: "context", namespace: "matrix", field: "os" });
  });

  it("collects matrix ref as input when interpolated in command", () => {
    const project = new Project("sdk-ctx");
    const pipeline = new Pipeline(project, "ci");
    const nodeMatrix = matrixContext.node!;
    const step = $`make test NODE=${nodeMatrix}`.build(pipeline, "test");
    expect(step.inputs).toContainEqual({ kind: "context", namespace: "matrix", field: "node" });
  });
});
