// Spec 30 — Saga compensations: SDK StepBuilder.compensate().
// Test plan items 2, 15.

import { describe, it, expect } from "vitest";
import { Project, Pipeline } from "@sverka/workflow";
import { $ } from "../index.js";

describe("Spec 30 — StepBuilder.compensate()", () => {
  it("item 2: .compensate('rollback.sh') sets compensation to { kind: 'shell', command: 'rollback.sh' }", () => {
    const proj = new Project("saga-sdk");
    const pipeline = new Pipeline(proj, "ci");
    const step = $`deploy`.compensate("rollback.sh").build(pipeline, "deploy");
    expect(step.compensation).toEqual({ kind: "shell", command: "rollback.sh" });
  });

  it("item 2: compensation undefined when .compensate() not called", () => {
    const proj = new Project("saga-sdk-none");
    const pipeline = new Pipeline(proj, "ci");
    const step = $`deploy.sh`.build(pipeline, "deploy");
    expect(step.compensation).toBeUndefined();
  });

  it("item 2: .compensate() is chainable and returns StepBuilder", () => {
    const proj = new Project("saga-sdk-chain");
    const pipeline = new Pipeline(proj, "ci");
    const builder = $`deploy`;
    const returned = builder.compensate("rollback.sh");
    // Same object (chainable)
    expect(returned).toBe(builder);
    const step = builder.build(pipeline, "deploy");
    expect(step.compensation).toEqual({ kind: "shell", command: "rollback.sh" });
  });
});
