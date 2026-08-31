import { describe, it, expect } from "vitest";
import { Project, Pipeline, ShellStep } from "../constructs.js";
import type { MatrixSpec } from "../model.js";

describe("MatrixSpec on Step", () => {
  it("stores matrix on ShellStep when provided", () => {
    const project = new Project("test-matrix");
    const pipeline = new Pipeline(project, "ci");
    const matrix: MatrixSpec = {
      dimensions: { node: [18, 20], os: ["ubuntu", "windows"] },
    };
    const step = new ShellStep(pipeline, "test", {
      command: "make test",
      matrix,
    });
    expect(step.matrix).toEqual(matrix);
    expect(step.matrix?.dimensions.node).toEqual([18, 20]);
  });

  it("matrix is undefined when not provided (exactOptionalPropertyTypes)", () => {
    const project = new Project("test-no-matrix");
    const pipeline = new Pipeline(project, "ci");
    const step = new ShellStep(pipeline, "test", { command: "make test" });
    expect(step.matrix).toBeUndefined();
  });

  it("stores include and exclude", () => {
    const project = new Project("test-inc-exc");
    const pipeline = new Pipeline(project, "ci");
    const matrix: MatrixSpec = {
      dimensions: { node: [18, 20] },
      include: [{ node: 22, experimental: 1 }],
      exclude: [{ node: 18 }],
    };
    const step = new ShellStep(pipeline, "test", {
      command: "make test",
      matrix,
    });
    expect(step.matrix?.include).toEqual([{ node: 22, experimental: 1 }]);
    expect(step.matrix?.exclude).toEqual([{ node: 18 }]);
  });

  it("matrix with string and number values", () => {
    const project = new Project("test-types");
    const pipeline = new Pipeline(project, "ci");
    const matrix: MatrixSpec = {
      dimensions: { version: ["1.0", "2.0"], count: [1, 2, 3] },
    };
    const step = new ShellStep(pipeline, "test", {
      command: "make test",
      matrix,
    });
    expect(step.matrix?.dimensions.version).toEqual(["1.0", "2.0"]);
    expect(step.matrix?.dimensions.count).toEqual([1, 2, 3]);
  });

  it("stores failFast and maxParallel", () => {
    const project = new Project("test-ff-mp");
    const pipeline = new Pipeline(project, "ci");
    const matrix: MatrixSpec = {
      dimensions: { node: [18, 20] },
      failFast: true,
      maxParallel: 2,
    };
    const step = new ShellStep(pipeline, "test", {
      command: "make test",
      matrix,
    });
    expect(step.matrix?.failFast).toBe(true);
    expect(step.matrix?.maxParallel).toBe(2);
  });
});
