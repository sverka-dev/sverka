import { describe, it, expect } from "vitest";
import { expandMatrixSteps } from "../matrix.js";
import { PlannerError } from "../errors.js";
import type { StepDefinition, MatrixSpec } from "@sverka/core";

function makeStep(id: string, matrix?: MatrixSpec, deps: string[] = []): StepDefinition {
  return {
    id,
    runtime: { mode: "host" },
    operations: [{ kind: "shell", command: "echo" }],
    inputs: [],
    outputs: [],
    dependencies: deps.map((p) => ({ kind: "control" as const, producer: p })),
    ...(matrix ? { matrix } : {}),
  };
}

describe("expandMatrixSteps", () => {
  it("passes through non-matrix steps unchanged", () => {
    const steps = [makeStep("a"), makeStep("b")];
    const result = expandMatrixSteps(steps);
    expect(result).toEqual(steps);
    expect(result).toHaveLength(2);
  });

  it("expands single-dimension matrix into N steps", () => {
    const steps = [makeStep("test", { dimensions: { node: [18, 20] } })];
    const result = expandMatrixSteps(steps);
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe("test[node=18]");
    expect(result[1]!.id).toBe("test[node=20]");
    expect(result[0]!.matrixValues).toEqual({ node: 18 });
    expect(result[1]!.matrixValues).toEqual({ node: 20 });
    expect(result[0]!.matrix).toBeUndefined();
  });

  it("expands multi-dimension matrix (cross-product, sorted keys)", () => {
    const steps = [makeStep("test", { dimensions: { node: [18, 20], os: ["ubuntu", "windows"] } })];
    const result = expandMatrixSteps(steps);
    expect(result).toHaveLength(4);
    const ids = result.map((s) => s.id);
    expect(ids).toContain("test[node=18,os=ubuntu]");
    expect(ids).toContain("test[node=18,os=windows]");
    expect(ids).toContain("test[node=20,os=ubuntu]");
    expect(ids).toContain("test[node=20,os=windows]");
  });

  it("filters excluded combinations", () => {
    const steps = [
      makeStep("test", {
        dimensions: { node: [18, 20], os: ["ubuntu", "windows"] },
        exclude: [{ node: 18, os: "windows" }],
      }),
    ];
    const result = expandMatrixSteps(steps);
    expect(result).toHaveLength(3);
    const ids = result.map((s) => s.id);
    expect(ids).not.toContain("test[node=18,os=windows]");
  });

  it("appends include entries", () => {
    const steps = [
      makeStep("test", {
        dimensions: { node: [18, 20] },
        include: [{ node: 22, experimental: 1 }],
      }),
    ];
    const result = expandMatrixSteps(steps);
    expect(result).toHaveLength(3);
    const includeStep = result.find((s) => s.matrixValues?.node === 22);
    expect(includeStep).toBeDefined();
    expect(includeStep?.matrixValues).toEqual({ node: 22, experimental: 1 });
  });

  it("rewires non-matrix dependency on matrix step to all expanded instances", () => {
    const steps = [
      makeStep("matrix-step", { dimensions: { node: [18, 20] } }),
      makeStep("consumer", undefined, ["matrix-step"]),
    ];
    const result = expandMatrixSteps(steps);
    expect(result).toHaveLength(3); // 2 expanded + 1 consumer
    const consumer = result.find((s) => s.id === "consumer");
    expect(consumer?.dependencies).toHaveLength(2);
    const producers = consumer?.dependencies.map((d) => d.producer);
    expect(producers).toContain("matrix-step[node=18]");
    expect(producers).toContain("matrix-step[node=20]");
  });

  it("matrix step depends on non-matrix step — dependency unchanged", () => {
    const steps = [
      makeStep("setup"),
      makeStep("test", { dimensions: { node: [18, 20] } }, ["setup"]),
    ];
    const result = expandMatrixSteps(steps);
    const expanded = result.filter((s) => s.id.startsWith("test["));
    expect(expanded).toHaveLength(2);
    for (const step of expanded) {
      expect(step.dependencies).toEqual([{ kind: "control", producer: "setup" }]);
    }
  });

  it("throws PlannerError for empty dimensions", () => {
    const steps = [makeStep("test", { dimensions: { node: [] } })];
    expect(() => expandMatrixSteps(steps)).toThrow(PlannerError);
    expect(() => expandMatrixSteps(steps)).toThrow(/no values/);
  });

  it("throws PlannerError when exclude removes all combinations", () => {
    const steps = [
      makeStep("test", {
        dimensions: { node: [18] },
        exclude: [{ node: 18 }],
      }),
    ];
    expect(() => expandMatrixSteps(steps)).toThrow(PlannerError);
    expect(() => expandMatrixSteps(steps)).toThrow(/no combinations/);
  });

  it("expands steps with failFast and maxParallel in spec", () => {
    const steps = [
      makeStep("test", {
        dimensions: { node: [18, 20] },
        failFast: false,
        maxParallel: 4,
      }),
    ];
    const result = expandMatrixSteps(steps);
    expect(result).toHaveLength(2);
    // failFast/maxParallel are consumed by target lowering, not stored on expanded steps.
    expect(result[0]!.matrix).toBeUndefined();
    expect(result[1]!.matrix).toBeUndefined();
    expect(result[0]!.matrixValues).toEqual({ node: 18 });
    expect(result[1]!.matrixValues).toEqual({ node: 20 });
  });

  it("does not carry matrix spec on expanded steps when not specified", () => {
    const steps = [makeStep("test", { dimensions: { node: [18, 20] } })];
    const result = expandMatrixSteps(steps);
    expect(result[0]!.matrix).toBeUndefined();
  });

  it("rewires step inputs to expanded producer IDs", () => {
    const producer = makeStep("build", { dimensions: { node: [18, 20] } });
    const consumer = makeStep("test", undefined, ["build"]);
    // Add a step-input reference to the producer
    consumer.inputs = [
      { kind: "step", step: "build", output: "artifact", type: "artifact" },
    ];
    const result = expandMatrixSteps([producer, consumer]);
    expect(result).toHaveLength(3); // 2 build + 1 test
    const testStep = result.find((s) => s.id === "test");
    expect(testStep).toBeDefined();
    expect(testStep!.inputs).toHaveLength(2);
    expect(testStep!.inputs.map((i) => (i as { step: string }).step)).toEqual(
      expect.arrayContaining(["build[node=18]", "build[node=20]"]),
    );
  });
});
