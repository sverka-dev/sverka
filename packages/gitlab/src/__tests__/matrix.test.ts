import { describe, it, expect } from "vitest";
import { Project, Pipeline, ShellStep, Entry, push } from "@sverka/cdk";
import type { ContextRef } from "@sverka/cdk";
import { synthesize } from "@sverka/core";
import { GitlabTarget } from "../target.js";

function matrixRef(field: string): ContextRef {
  return { kind: "context", namespace: "matrix", field };
}

function makeGraphWithMatrix(matrixSpec: unknown, command = "make test", inputs: ContextRef[] = []) {
  const project = new Project("gl-matrix-test");
  const pipeline = new Pipeline(project, "ci");
  new ShellStep(pipeline, "test", {
    command,
    matrix: matrixSpec as any,
    ...(inputs.length > 0 ? { inputs } : {}),
  });
  new Entry(pipeline, "push", { trigger: push(), roots: ["test"] });
  return synthesize(project);
}

describe("GitLab matrix lowering", () => {
  it("expands dimensions to parallel.matrix cross-product", () => {
    const graph = makeGraphWithMatrix({
      dimensions: { node: [18, 20], os: ["ubuntu", "windows"] },
    });
    const target = new GitlabTarget();
    const targetGraph = target.lower(graph);
    const job = targetGraph.jobs.find((j) => j.id === "test");
    expect(job?.parallel).toBeDefined();
    expect(job?.parallel!.matrix).toHaveLength(4);
    expect(job?.parallel!.matrix).toContainEqual({ node: [18], os: ["ubuntu"] });
    expect(job?.parallel!.matrix).toContainEqual({ node: [18], os: ["windows"] });
    expect(job?.parallel!.matrix).toContainEqual({ node: [20], os: ["ubuntu"] });
    expect(job?.parallel!.matrix).toContainEqual({ node: [20], os: ["windows"] });
  });

  it("filters excluded combinations from parallel.matrix", () => {
    const graph = makeGraphWithMatrix({
      dimensions: { node: [18, 20], os: ["ubuntu", "windows"] },
      exclude: [{ node: 18, os: "windows" }],
    });
    const target = new GitlabTarget();
    const targetGraph = target.lower(graph);
    const job = targetGraph.jobs.find((j) => j.id === "test");
    expect(job?.parallel!.matrix).toHaveLength(3);
    expect(job?.parallel!.matrix).not.toContainEqual({ node: [18], os: ["windows"] });
  });

  it("appends include entries to parallel.matrix", () => {
    const graph = makeGraphWithMatrix({
      dimensions: { node: [18, 20] },
      include: [{ node: 22, experimental: 1 }],
    });
    const target = new GitlabTarget();
    const targetGraph = target.lower(graph);
    const job = targetGraph.jobs.find((j) => j.id === "test");
    expect(job?.parallel!.matrix).toHaveLength(3);
    expect(job?.parallel!.matrix).toContainEqual({ node: [22], experimental: [1] });
  });

  it("translates matrix.* context refs to $VAR (uppercase)", () => {
    const graph = makeGraphWithMatrix(
      { dimensions: { node: [18, 20] } },
      "make test NODE=${matrix.node}",
      [matrixRef("node")],
    );
    const target = new GitlabTarget();
    const targetGraph = target.lower(graph);
    const job = targetGraph.jobs.find((j) => j.id === "test");
    expect(job?.script).toContain("make test NODE=$NODE");
  });

  it("no parallel key when step has no matrix", () => {
    const graph = makeGraphWithMatrix(undefined);
    const target = new GitlabTarget();
    const targetGraph = target.lower(graph);
    const job = targetGraph.jobs.find((j) => j.id === "test");
    expect(job?.parallel).toBeUndefined();
  });

  it("emits parallel in YAML", () => {
    const graph = makeGraphWithMatrix({ dimensions: { node: [18, 20] } });
    const target = new GitlabTarget();
    const artifacts = target.compile(graph).artifacts;
    const yaml = artifacts[0]!.content;
    expect(yaml).toContain("parallel:");
    expect(yaml).toContain("matrix:");
  });

  it("emulates exclude — produces warning diagnostic", () => {
    const graph = makeGraphWithMatrix({
      dimensions: { node: [18, 20] },
      exclude: [{ node: 18 }],
    });
    const target = new GitlabTarget();
    const result = target.compile(graph);
    const excludeDiag = result.diagnostics.find((d) => d.capability === "matrix.exclude");
    expect(excludeDiag).toBeDefined();
    expect(excludeDiag?.support).toBe("emulated");
  });

  it("failFast unsupported — produces error diagnostic", () => {
    const graph = makeGraphWithMatrix({
      dimensions: { node: [18, 20] },
      failFast: false,
    });
    const target = new GitlabTarget();
    const result = target.compile(graph);
    const diag = result.diagnostics.find((d) => d.capability === "matrix.failFast");
    expect(diag).toBeDefined();
    expect(diag?.support).toBe("unsupported");
  });

  it("maxParallel unsupported — produces error diagnostic", () => {
    const graph = makeGraphWithMatrix({
      dimensions: { node: [18, 20] },
      maxParallel: 4,
    });
    const target = new GitlabTarget();
    const result = target.compile(graph);
    const diag = result.diagnostics.find((d) => d.capability === "matrix.maxParallel");
    expect(diag).toBeDefined();
    expect(diag?.support).toBe("unsupported");
  });
});
