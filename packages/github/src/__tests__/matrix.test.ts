import { describe, it, expect } from "vitest";
import { Project, Pipeline, ShellStep, Entry, push } from "@sverka/cdk";
import type { ContextRef } from "@sverka/cdk";
import { synthesize } from "@sverka/core";
import { GithubTarget } from "../target.js";
import { GithubTargetError } from "../errors.js";
import type { GithubTargetGraph } from "../types.js";

function singleGraph(result: GithubTargetGraph | readonly GithubTargetGraph[]): GithubTargetGraph {
  if ("jobs" in result) return result;
  return result[0]!;
}

function matrixRef(field: string): ContextRef {
  return { kind: "context", namespace: "matrix", field };
}

function makeGraphWithMatrix(matrixSpec: unknown, command = "make test", inputs: ContextRef[] = []) {
  const project = new Project("gh-matrix-test");
  const pipeline = new Pipeline(project, "ci");
  new ShellStep(pipeline, "test", {
    command,
    matrix: matrixSpec as any,
    ...(inputs.length > 0 ? { inputs } : {}),
  });
  new Entry(pipeline, "push", { trigger: push(), roots: ["test"] });
  return synthesize(project);
}

describe("GitHub matrix lowering", () => {
  it("lowers dimensions to strategy.matrix", () => {
    const graph = makeGraphWithMatrix({
      dimensions: { node: [18, 20], os: ["ubuntu", "windows"] },
    });
    const target = new GithubTarget();
    const targetGraph = singleGraph(target.lower(graph));
    const job = targetGraph.jobs[0]!;
    expect(job.strategy).toBeDefined();
    expect(job.strategy!.matrix).toEqual({
      node: [18, 20],
      os: ["ubuntu", "windows"],
    });
  });

  it("lowers include to strategy.matrix.include", () => {
    const graph = makeGraphWithMatrix({
      dimensions: { node: [18, 20] },
      include: [{ node: 22, experimental: 1 }],
    });
    const target = new GithubTarget();
    const targetGraph = singleGraph(target.lower(graph));
    expect(targetGraph.jobs[0]!.strategy!.matrix).toEqual({
      node: [18, 20],
      include: [{ node: 22, experimental: 1 }],
    });
  });

  it("lowers exclude to strategy.matrix.exclude", () => {
    const graph = makeGraphWithMatrix({
      dimensions: { node: [18, 20] },
      exclude: [{ node: 18 }],
    });
    const target = new GithubTarget();
    const targetGraph = singleGraph(target.lower(graph));
    expect(targetGraph.jobs[0]!.strategy!.matrix).toEqual({
      node: [18, 20],
      exclude: [{ node: 18 }],
    });
  });

  it("translates matrix.* context refs to ${{ matrix.var }}", () => {
    const graph = makeGraphWithMatrix(
      { dimensions: { node: [18, 20] } },
      "make test NODE=${matrix.node}",
      [matrixRef("node")],
    );
    const target = new GithubTarget();
    const targetGraph = singleGraph(target.lower(graph));
    const runStep = targetGraph.jobs[0]!.steps.find((s) => s.run !== undefined);
    expect(runStep?.run).toBe("make test NODE=${{ matrix.node }}");
  });

  it("no strategy key when step has no matrix", () => {
    const graph = makeGraphWithMatrix(undefined);
    const target = new GithubTarget();
    const targetGraph = singleGraph(target.lower(graph));
    expect(targetGraph.jobs[0]!.strategy).toBeUndefined();
  });

  it("emits strategy in YAML", () => {
    const graph = makeGraphWithMatrix({ dimensions: { node: [18, 20] } });
    const target = new GithubTarget();
    const artifacts = target.compile(graph).artifacts;
    const yaml = artifacts[0]!.content;
    expect(yaml).toContain("strategy:");
    expect(yaml).toContain("matrix:");
    expect(yaml).toContain("node:");
  });

  it("lowers failFast to strategy.fail-fast", () => {
    const graph = makeGraphWithMatrix({
      dimensions: { node: [18, 20] },
      failFast: false,
    });
    const target = new GithubTarget();
    const targetGraph = singleGraph(target.lower(graph));
    expect(targetGraph.jobs[0]!.strategy!.failFast).toBe(false);
  });

  it("lowers maxParallel to strategy.max-parallel", () => {
    const graph = makeGraphWithMatrix({
      dimensions: { node: [18, 20] },
      maxParallel: 4,
    });
    const target = new GithubTarget();
    const targetGraph = singleGraph(target.lower(graph));
    expect(targetGraph.jobs[0]!.strategy!.maxParallel).toBe(4);
  });

  it("emits fail-fast and max-parallel in YAML", () => {
    const graph = makeGraphWithMatrix({
      dimensions: { node: [18, 20] },
      failFast: false,
      maxParallel: 2,
    });
    const target = new GithubTarget();
    const artifacts = target.compile(graph).artifacts;
    const yaml = artifacts[0]!.content;
    expect(yaml).toContain("fail-fast:");
    expect(yaml).toContain("max-parallel:");
  });

  it("no fail-fast/max-parallel when not specified", () => {
    const graph = makeGraphWithMatrix({ dimensions: { node: [18, 20] } });
    const target = new GithubTarget();
    const targetGraph = singleGraph(target.lower(graph));
    expect(targetGraph.jobs[0]!.strategy!.failFast).toBeUndefined();
    expect(targetGraph.jobs[0]!.strategy!.maxParallel).toBeUndefined();
  });

  it("rejects zero maxParallel", () => {
    const graph = makeGraphWithMatrix({
      dimensions: { node: [18, 20] },
      maxParallel: 0,
    });
    const target = new GithubTarget();
    expect(() => target.lower(graph)).toThrow(GithubTargetError);
    expect(() => target.lower(graph)).toThrow(/positive integer/);
  });

  it("rejects negative maxParallel", () => {
    const graph = makeGraphWithMatrix({
      dimensions: { node: [18, 20] },
      maxParallel: -1,
    });
    const target = new GithubTarget();
    expect(() => target.lower(graph)).toThrow(GithubTargetError);
  });

  it("rejects fractional maxParallel", () => {
    const graph = makeGraphWithMatrix({
      dimensions: { node: [18, 20] },
      maxParallel: 2.5,
    });
    const target = new GithubTarget();
    expect(() => target.lower(graph)).toThrow(GithubTargetError);
  });
});
