// Spec 30 — Saga compensations: synthesis + validation.
// Test plan items 1 (synthesis side), 3, 15.

import { describe, it, expect } from "vitest";
import { Project, Pipeline, ShellStep, Entry, push } from "../../cdk/index.js";
import { synthesize } from "../synthesize.js";
import { SynthesisError } from "../errors.js";

/** Build a single-step pipeline with the given compensation for testing. */
function makeSingleStepPipeline(
  projectId: string,
  compensation: unknown,
): ReturnType<typeof synthesize> | never {
  const project = new Project(projectId);
  const pipeline = new Pipeline(project, "ci");
  new ShellStep(pipeline, "deploy", {
    command: "deploy.sh",
    compensation: compensation as never,
  });
  new Entry(pipeline, "push", { trigger: push(), roots: ["deploy"] });
  return synthesize(project);
}

/** Expect synthesize to throw with the given error code. */
function expectSynthesisError(projectId: string, compensation: unknown): void {
  expect(() => makeSingleStepPipeline(projectId, compensation)).toThrowError(
    expect.objectContaining({ code: "INVALID_COMPENSATION" }),
  );
}

describe("Spec 30 — compensation in synthesis", () => {
  it("item 1: Step with compensation synthesizes to StepDefinition with compensation", () => {
    const graph = makeSingleStepPipeline("saga-synth", { kind: "shell", command: "cleanup.sh" });
    const step = graph.project.pipelines[0]!.steps.find((s) => s.id === "ci/deploy");
    expect(step?.compensation).toEqual({ kind: "shell", command: "cleanup.sh" });
  });

  it("item 1: compensation undefined when not provided (exactOptionalPropertyTypes)", () => {
    const project = new Project("saga-synth-none");
    const pipeline = new Pipeline(project, "ci");
    new ShellStep(pipeline, "build", { command: "make build" });
    new Entry(pipeline, "push", { trigger: push(), roots: ["build"] });
    const graph = synthesize(project);
    const step = graph.project.pipelines[0]!.steps.find((s) => s.id === "ci/build");
    expect(step?.compensation).toBeUndefined();
    expect("compensation" in step!).toBe(false);
  });

  it("item 3: non-shell compensation.kind raises INVALID_COMPENSATION", () => {
    expectSynthesisError("saga-invalid", { kind: "exportOutput", name: "x", type: "string" });
  });

  it("item 3: SynthesisError is thrown (not a plain Error)", () => {
    let caught: unknown;
    try {
      makeSingleStepPipeline("saga-invalid-type", { kind: "diagnostic", message: "x", severity: "info" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SynthesisError);
  });

  it("empty compensation command raises INVALID_COMPENSATION", () => {
    expectSynthesisError("saga-empty", { kind: "shell", command: "" });
  });

  it("whitespace-only compensation command raises INVALID_COMPENSATION", () => {
    expectSynthesisError("saga-ws", { kind: "shell", command: "   " });
  });

  it("null compensation raises INVALID_COMPENSATION", () => {
    expectSynthesisError("saga-null", null);
  });

  it("non-object compensation (string) raises INVALID_COMPENSATION", () => {
    expectSynthesisError("saga-str", "rollback.sh");
  });

  it("non-string compensation command (number) raises INVALID_COMPENSATION", () => {
    expectSynthesisError("saga-numcmd", { kind: "shell", command: 1 });
  });
});
