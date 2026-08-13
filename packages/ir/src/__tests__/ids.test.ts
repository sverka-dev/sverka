import { describe, it, expect } from "vitest";
import { Project, Pipeline, ShellStep } from "@sverka/constructs";
import { synthesize } from "@sverka/core";
import { computeGraphId, computeRunPlanId } from "../ids.js";
import { makeSampleGraph, makeSampleRunPlan } from "./helpers/fixtures.js";

describe("computeGraphId", () => {
  it("produces a graph- prefixed id with 64 hex chars", () => {
    const id = computeGraphId(makeSampleGraph());
    expect(id).toMatch(/^graph-[0-9a-f]{64}$/);
  });

  it("is deterministic (same graph → same id)", () => {
    const a = computeGraphId(makeSampleGraph());
    const b = computeGraphId(makeSampleGraph());
    expect(a).toBe(b);
  });

  it("produces different ids for different graphs", () => {
    const graph1 = makeSampleGraph();
    const proj = new Project("other");
    const pipeline = new Pipeline(proj, "ci");
    new ShellStep(pipeline, "build", { command: "different" });
    const graph2 = synthesize(proj);
    expect(computeGraphId(graph1)).not.toBe(computeGraphId(graph2));
  });
});

describe("computeRunPlanId", () => {
  it("produces an rp- prefixed id with 64 hex chars", () => {
    const plan = makeSampleRunPlan(makeSampleGraph());
    const { id: _id, createdAt: _createdAt, ...body } = plan;
    const id = computeRunPlanId(body);
    expect(id).toMatch(/^rp-[0-9a-f]{64}$/);
  });

  it("is deterministic (same plan → same id)", () => {
    const plan = makeSampleRunPlan(makeSampleGraph());
    const { id: _id, createdAt: _createdAt, ...body } = plan;
    const a = computeRunPlanId(body);
    const b = computeRunPlanId(body);
    expect(a).toBe(b);
  });

  it("excludes id and createdAt from the hash", () => {
    const plan = makeSampleRunPlan(makeSampleGraph());
    const { id: _id1, createdAt: _c1, ...body1 } = plan;
    const { id: _id2, createdAt: _c2, ...body2 } = {
      ...plan,
      id: "rp-different",
      createdAt: "2025-01-01T00:00:00.000Z",
    };
    expect(computeRunPlanId(body1)).toBe(computeRunPlanId(body2));
  });
});
