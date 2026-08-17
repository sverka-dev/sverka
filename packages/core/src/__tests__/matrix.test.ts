import { describe, it, expect } from "vitest";
import { Project, Pipeline, ShellStep, Entry, push } from "@sverka/cdk";
import { synthesize } from "../synthesize.js";
import type { MatrixSpec } from "@sverka/cdk";

describe("Matrix in synthesis", () => {
  it("carries matrix through to StepDefinition", () => {
    const project = new Project("test-matrix");
    const pipeline = new Pipeline(project, "ci");
    const matrix: MatrixSpec = {
      dimensions: { node: [18, 20], os: ["ubuntu", "windows"] },
    };
    new ShellStep(pipeline, "test", { command: "make test", matrix });
    new Entry(pipeline, "push", { trigger: push(), roots: ["test"] });

    const graph = synthesize(project);
    const step = graph.project.pipelines[0]!.steps.find((s) => s.id === "ci/test");
    expect(step).toBeDefined();
    expect(step?.matrix).toEqual(matrix);
  });

  it("does not set matrix field when not provided (exactOptionalPropertyTypes)", () => {
    const project = new Project("test-no-matrix");
    const pipeline = new Pipeline(project, "ci");
    new ShellStep(pipeline, "test", { command: "make test" });
    new Entry(pipeline, "push", { trigger: push(), roots: ["test"] });

    const graph = synthesize(project);
    const step = graph.project.pipelines[0]!.steps.find((s) => s.id === "ci/test");
    expect(step).toBeDefined();
    expect(step?.matrix).toBeUndefined();
    expect("matrix" in step!).toBe(false);
  });

  it("carries include and exclude through synthesis", () => {
    const project = new Project("test-inc-exc");
    const pipeline = new Pipeline(project, "ci");
    const matrix: MatrixSpec = {
      dimensions: { node: [18, 20] },
      include: [{ node: 22 }],
      exclude: [{ node: 18 }],
    };
    new ShellStep(pipeline, "test", { command: "make test", matrix });
    new Entry(pipeline, "push", { trigger: push(), roots: ["test"] });

    const graph = synthesize(project);
    const step = graph.project.pipelines[0]!.steps.find((s) => s.id === "ci/test");
    expect(step?.matrix?.include).toEqual([{ node: 22 }]);
    expect(step?.matrix?.exclude).toEqual([{ node: 18 }]);
  });
});
