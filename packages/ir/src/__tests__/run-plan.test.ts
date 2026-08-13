import { describe, it, expect } from "vitest";
import { makeSampleRunPlan, makeSampleGraph } from "./helpers/fixtures.js";
import type { RunPlan, BoundEntry, InputValue } from "../run-plan.js";

describe("RunPlan schema", () => {
  it("has apiVersion, id, graphId, entry, inputs, steps, createdAt", () => {
    const plan = makeSampleRunPlan(makeSampleGraph());
    expect(plan.apiVersion).toBe("sverka.dev/v1run");
    expect(typeof plan.id).toBe("string");
    expect(typeof plan.graphId).toBe("string");
    expect(plan.entry).toBeDefined();
    expect(plan.inputs).toBeDefined();
    expect(Array.isArray(plan.steps)).toBe(true);
    expect(typeof plan.createdAt).toBe("string");
  });

  it("BoundEntry has id and trigger", () => {
    const plan = makeSampleRunPlan(makeSampleGraph());
    const entry: BoundEntry = plan.entry;
    expect(typeof entry.id).toBe("string");
    expect(entry.trigger).toBeDefined();
    expect(entry.trigger.kind).toBe("push");
  });

  it("inputs is a flat record of InputValue", () => {
    const plan = makeSampleRunPlan(makeSampleGraph());
    const inputs = plan.inputs;
    expect(typeof inputs).toBe("object");
    expect(Array.isArray(inputs)).toBe(false);
    for (const v of Object.values(inputs)) {
      const val: InputValue = v;
      expect(["string", "number", "boolean"]).toContain(typeof val);
    }
  });

  it("steps is an array of StepDefinition", () => {
    const plan = makeSampleRunPlan(makeSampleGraph());
    expect(plan.steps.length).toBeGreaterThan(0);
    for (const step of plan.steps) {
      expect(typeof step.id).toBe("string");
      expect(step.runtime).toBeDefined();
      expect(Array.isArray(step.operations)).toBe(true);
    }
  });
});
