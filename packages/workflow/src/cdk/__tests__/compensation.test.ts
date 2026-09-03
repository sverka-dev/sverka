// Spec 30 — Saga compensations: cdk model field.
// Test plan items 1 (cdk side), 15.

import { describe, it, expect } from "vitest";
import { Project, Pipeline, ShellStep } from "../constructs.js";
import type { OperationDefinition } from "../../core/graph.js";

describe("Spec 30 — compensation field on Step (cdk)", () => {
  it("stores compensation on ShellStep", () => {
    const project = new Project("saga-cdk-store");
    const pipeline = new Pipeline(project, "ci");
    const compensation: OperationDefinition = { kind: "shell", command: "rollback.sh" };
    const step = new ShellStep(pipeline, "deploy", {
      command: "deploy.sh",
      compensation,
    });
    expect(step.compensation).toEqual({ kind: "shell", command: "rollback.sh" });
  });

  it("compensation is undefined when not provided", () => {
    const project = new Project("saga-cdk-none");
    const pipeline = new Pipeline(project, "ci");
    const step = new ShellStep(pipeline, "build", { command: "make build" });
    expect(step.compensation).toBeUndefined();
  });
});
