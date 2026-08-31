import { describe, it, expect } from "vitest";
import { bindRunPlan, computeReachableSteps } from "../bind.js";
import { PlannerError } from "../errors.js";
import type { DefinitionGraph, StepDefinition, Dependency } from "@sverka/workflow";
import { computeGraphId, computeRunPlanId } from "@sverka/workflow";

function makeStep(id: string, deps: Dependency[] = []): StepDefinition {
  return {
    id,
    runtime: {},
    operations: [{ kind: "shell", command: `echo ${id}` }],
    inputs: [],
    outputs: [],
    dependencies: deps,
  };
}

function makeGraph(
  steps: StepDefinition[],
  opts?: {
    entries?: { id: string; trigger: { kind: "push" }; roots: string[] }[];
    inputs?: Record<string, { type: "string" | "number" | "boolean"; default?: string | number | boolean; required?: boolean; secret?: boolean }>;
  },
): DefinitionGraph {
  return {
    project: {
      id: "test",
      pipelines: [{
        id: "ci",
        inputs: opts?.inputs ?? {},
        entries: opts?.entries ?? [{ id: "ci/on-push", trigger: { kind: "push" }, roots: steps.length > 0 ? [steps[0]!.id] : [] }],
        steps,
        outputs: [],
      }],
    },
  };
}

describe("bindRunPlan", () => {
  it("binds a single-step graph into a RunPlan", () => {
    const graph = makeGraph([makeStep("ci/build")]);
    const plan = bindRunPlan({ graph, entryId: "ci/on-push" });
    expect(plan.apiVersion).toBe("sverka.dev/v1run");
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]!.id).toBe("ci/build");
    expect(plan.entry.id).toBe("ci/on-push");
  });

  it("includes all reachable steps with dependencies", () => {
    const graph = makeGraph([
      makeStep("ci/build"),
      makeStep("ci/test", [{ kind: "control", producer: "ci/build" }]),
      makeStep("ci/deploy", [{ kind: "control", producer: "ci/test" }]),
    ], { entries: [{ id: "ci/on-push", trigger: { kind: "push" }, roots: ["ci/deploy"] }] });
    const plan = bindRunPlan({ graph, entryId: "ci/on-push" });
    expect(plan.steps).toHaveLength(3);
    const ids = plan.steps.map((s) => s.id);
    expect(ids).toContain("ci/build");
    expect(ids).toContain("ci/test");
    expect(ids).toContain("ci/deploy");
  });

  it("excludes unreachable steps", () => {
    const graph = makeGraph([
      makeStep("ci/build"),
      makeStep("ci/test", [{ kind: "control", producer: "ci/build" }]),
      makeStep("ci/unrelated"),
    ], { entries: [{ id: "ci/on-push", trigger: { kind: "push" }, roots: ["ci/test"] }] });
    const plan = bindRunPlan({ graph, entryId: "ci/on-push" });
    expect(plan.steps).toHaveLength(2);
    const ids = plan.steps.map((s) => s.id);
    expect(ids).toContain("ci/build");
    expect(ids).toContain("ci/test");
    expect(ids).not.toContain("ci/unrelated");
  });

  it("binds inputs from defaults", () => {
    const graph = makeGraph([makeStep("ci/build")], {
      inputs: { env: { type: "string", default: "production" } },
    });
    const plan = bindRunPlan({ graph, entryId: "ci/on-push" });
    expect(plan.inputs.env).toBe("production");
  });

  it("user inputs override defaults", () => {
    const graph = makeGraph([makeStep("ci/build")], {
      inputs: { env: { type: "string", default: "production" } },
    });
    const plan = bindRunPlan({ graph, entryId: "ci/on-push", inputs: { env: "staging" } });
    expect(plan.inputs.env).toBe("staging");
  });

  it("missing required input throws PlannerError(MISSING_INPUT)", () => {
    const graph = makeGraph([makeStep("ci/build")], {
      inputs: { env: { type: "string", required: true } },
    });
    expect(() => bindRunPlan({ graph, entryId: "ci/on-push" })).toThrow(PlannerError);
    try {
      bindRunPlan({ graph, entryId: "ci/on-push" });
    } catch (e) {
      expect((e as PlannerError).code).toBe("MISSING_INPUT");
    }
  });

  it("entry not found throws PlannerError(ENTRY_NOT_FOUND)", () => {
    const graph = makeGraph([makeStep("ci/build")]);
    expect(() => bindRunPlan({ graph, entryId: "nonexistent" })).toThrow(PlannerError);
    try {
      bindRunPlan({ graph, entryId: "nonexistent" });
    } catch (e) {
      expect((e as PlannerError).code).toBe("ENTRY_NOT_FOUND");
    }
  });

  it("root not found throws PlannerError(ROOT_NOT_FOUND)", () => {
    const graph = makeGraph([makeStep("ci/build")], {
      entries: [{ id: "ci/on-push", trigger: { kind: "push" }, roots: ["nonexistent"] }],
    });
    expect(() => bindRunPlan({ graph, entryId: "ci/on-push" })).toThrow(PlannerError);
    try {
      bindRunPlan({ graph, entryId: "ci/on-push" });
    } catch (e) {
      expect((e as PlannerError).code).toBe("ROOT_NOT_FOUND");
    }
  });

  it("produces deterministic runPlanId for same content", () => {
    const graph = makeGraph([makeStep("ci/build")]);
    const plan1 = bindRunPlan({ graph, entryId: "ci/on-push" });
    const plan2 = bindRunPlan({ graph, entryId: "ci/on-push" });
    // IDs differ only by createdAt, but runPlanId excludes createdAt.
    // However, the id IS computed from the body excluding id/createdAt,
    // so same content → same id.
    expect(plan1.id).toBe(plan2.id);
  });

  it("produces graphId matching computeGraphId", () => {
    const graph = makeGraph([makeStep("ci/build")]);
    const plan = bindRunPlan({ graph, entryId: "ci/on-push" });
    expect(plan.graphId).toBe(computeGraphId(graph));
  });

  it("sets createdAt to ISO string", () => {
    const graph = makeGraph([makeStep("ci/build")]);
    const plan = bindRunPlan({ graph, entryId: "ci/on-push" });
    expect(() => new Date(plan.createdAt).toISOString()).not.toThrow();
    expect(plan.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("rejects cyclic dependency graphs with INVALID_GRAPH", () => {
    const graph = makeGraph([
      makeStep("ci/build", [{ kind: "control", producer: "ci/test" }]),
      makeStep("ci/test", [{ kind: "control", producer: "ci/build" }]),
    ]);
    expect(() => bindRunPlan({ graph, entryId: "ci/on-push" })).toThrow(PlannerError);
    try {
      bindRunPlan({ graph, entryId: "ci/on-push" });
    } catch (e) {
      expect((e as PlannerError).code).toBe("INVALID_GRAPH");
    }
  });

  it("rejects malformed graphs with INVALID_GRAPH before dereferencing fields", () => {
    const graph = { project: {} } as unknown as DefinitionGraph;
    expect(() => bindRunPlan({ graph, entryId: "ci/on-push" })).toThrow(PlannerError);
    try {
      bindRunPlan({ graph, entryId: "ci/on-push" });
    } catch (e) {
      expect((e as PlannerError).code).toBe("INVALID_GRAPH");
    }
  });

  it("rejects type-mismatched user inputs with INVALID_INPUT", () => {
    const graph = makeGraph([makeStep("ci/build")], {
      inputs: { env: { type: "string" } },
    });
    expect(() => bindRunPlan({ graph, entryId: "ci/on-push", inputs: { env: 123 } })).toThrow(PlannerError);
    try {
      bindRunPlan({ graph, entryId: "ci/on-push", inputs: { env: 123 } });
    } catch (e) {
      expect((e as PlannerError).code).toBe("INVALID_INPUT");
    }
  });

  it("rejects secret inputs with invalid declared types", () => {
    const graph = makeGraph([makeStep("ci/build")], {
      inputs: { token: { type: "invalid" as "string", secret: true } },
    });
    expect(() => bindRunPlan({ graph, entryId: "ci/on-push" })).toThrow(PlannerError);
    try {
      bindRunPlan({ graph, entryId: "ci/on-push" });
    } catch (e) {
      expect((e as PlannerError).code).toBe("INVALID_GRAPH");
    }
  });

  it("rejects optional inputs with invalid declared types", () => {
    const graph = makeGraph([makeStep("ci/build")], {
      inputs: { env: { type: "invalid" as "string", required: false } },
    });
    expect(() => bindRunPlan({ graph, entryId: "ci/on-push" })).toThrow(PlannerError);
    try {
      bindRunPlan({ graph, entryId: "ci/on-push" });
    } catch (e) {
      expect((e as PlannerError).code).toBe("INVALID_GRAPH");
    }
  });

  it("rejects null input descriptor with INVALID_GRAPH", () => {
    const graph = makeGraph([makeStep("ci/build")], {
      inputs: { env: null as unknown as { type: "string" } },
    });
    expect(() => bindRunPlan({ graph, entryId: "ci/on-push" })).toThrow(PlannerError);
    try {
      bindRunPlan({ graph, entryId: "ci/on-push" });
    } catch (e) {
      expect((e as PlannerError).code).toBe("INVALID_GRAPH");
    }
  });
});

describe("computeReachableSteps", () => {
  it("computes transitive closure from roots", () => {
    const steps = [
      makeStep("a"),
      makeStep("b", [{ kind: "control", producer: "a" }]),
      makeStep("c", [{ kind: "control", producer: "b" }]),
    ];
    const result = computeReachableSteps(steps, ["c"]);
    expect(result).toHaveLength(3);
    expect(result.map((s) => s.id)).toContain("a");
    expect(result.map((s) => s.id)).toContain("b");
    expect(result.map((s) => s.id)).toContain("c");
  });

  it("empty roots → empty result", () => {
    const steps = [makeStep("a")];
    const result = computeReachableSteps(steps, []);
    expect(result).toHaveLength(0);
  });

  it("handles diamond dependencies (no duplicates)", () => {
    const steps = [
      makeStep("a"),
      makeStep("b", [{ kind: "control", producer: "a" }]),
      makeStep("c", [{ kind: "control", producer: "a" }]),
      makeStep("d", [{ kind: "control", producer: "b" }, { kind: "control", producer: "c" }]),
    ];
    const result = computeReachableSteps(steps, ["d"]);
    expect(result).toHaveLength(4);
    // No duplicates
    const ids = result.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("PlannerError", () => {
  it("extends Error with code and cause", () => {
    const err = new PlannerError("test", "ENTRY_NOT_FOUND");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("ENTRY_NOT_FOUND");
    expect(err.cause).toBeUndefined();
  });

  it("stores cause when provided", () => {
    const cause = new Error("root");
    const err = new PlannerError("test", "MISSING_INPUT", cause);
    expect(err.cause).toBe(cause);
  });
});

describe("bindRunPlan — pipeline call expansion", () => {
  it("expands call steps into inline callee steps in the RunPlan", () => {
    const graph: DefinitionGraph = {
      project: {
        id: "test",
        pipelines: [
          {
            id: "deploy",
            inputs: { env: { type: "string", required: true } },
            entries: [],
            steps: [
              {
                id: "deploy/deploy",
                runtime: {},
                operations: [{ kind: "shell", command: "deploy" }],
                inputs: [],
                outputs: [{ name: "url", type: "string" }],
                dependencies: [],
              },
            ],
            outputs: [{ name: "url", type: "string", stepId: "deploy/deploy" }],
          },
          {
            id: "ci",
            inputs: {},
            entries: [{ id: "ci/on-push", trigger: { kind: "push" }, roots: ["ci/deploy-staging"] }],
            steps: [
              {
                id: "ci/build",
                runtime: {},
                operations: [{ kind: "shell", command: "make build" }],
                inputs: [],
                outputs: [],
                dependencies: [],
              },
              {
                id: "ci/deploy-staging",
                runtime: {},
                operations: [],
                inputs: [],
                outputs: [{ name: "url", type: "string" }],
                dependencies: [{ kind: "control", producer: "ci/build" }],
                call: { callee: "deploy", inputs: { env: "staging" } },
              },
            ],
            outputs: [],
          },
        ],
      },
    };

    const plan = bindRunPlan({ graph, entryId: "ci/on-push" });
    const ids = plan.steps.map((s) => s.id);
    // Call step should be expanded — no "ci/deploy-staging" in steps.
    expect(ids).not.toContain("ci/deploy-staging");
    // Should contain the namespaced callee step.
    expect(ids).toContain("ci/deploy-staging/deploy");
    // Should still contain the caller's build step.
    expect(ids).toContain("ci/build");
    // No step should have a `call` field.
    expect(plan.steps.every((s) => s.call === undefined)).toBe(true);
  });
});
