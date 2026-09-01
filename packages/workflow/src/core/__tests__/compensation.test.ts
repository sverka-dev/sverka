// Spec 30 — Saga compensations: synthesis + validation.
// Test plan items 1 (synthesis side), 3, 15.

import { describe, it, expect } from "vitest";
import { Project, Pipeline, ShellStep, Entry, push } from "../../cdk/index.js";
import { synthesize } from "../synthesize.js";
import { SynthesisError } from "../errors.js";

describe("Spec 30 — compensation in synthesis", () => {
  it("item 1: Step with compensation synthesizes to StepDefinition with compensation", () => {
    const project = new Project("saga-synth");
    const pipeline = new Pipeline(project, "ci");
    new ShellStep(pipeline, "deploy", {
      command: "deploy.sh",
      compensation: { kind: "shell", command: "cleanup.sh" },
    });
    new Entry(pipeline, "push", { trigger: push(), roots: ["deploy"] });

    const graph = synthesize(project);
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
    const project = new Project("saga-invalid");
    const pipeline = new Pipeline(project, "ci");
    // Cast to bypass the TS type (compensation is OperationDefinition; we test
    // runtime validation). exportOutput is not a valid compensation kind.
    new ShellStep(pipeline, "deploy", {
      command: "deploy.sh",
      compensation: { kind: "exportOutput", name: "x", type: "string" } as never,
    });
    new Entry(pipeline, "push", { trigger: push(), roots: ["deploy"] });

    expect(() => synthesize(project)).toThrowError(
      expect.objectContaining({ code: "INVALID_COMPENSATION" }),
    );
  });

  it("item 3: SynthesisError is thrown (not a plain Error)", () => {
    const project = new Project("saga-invalid-type");
    const pipeline = new Pipeline(project, "ci");
    new ShellStep(pipeline, "deploy", {
      command: "deploy.sh",
      compensation: { kind: "diagnostic", message: "x", severity: "info" } as never,
    });
    new Entry(pipeline, "push", { trigger: push(), roots: ["deploy"] });

    let caught: unknown;
    try {
      synthesize(project);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SynthesisError);
  });

  it("empty compensation command raises INVALID_COMPENSATION", () => {
    const project = new Project("saga-empty");
    const pipeline = new Pipeline(project, "ci");
    new ShellStep(pipeline, "deploy", {
      command: "deploy.sh",
      compensation: { kind: "shell", command: "" },
    });
    new Entry(pipeline, "push", { trigger: push(), roots: ["deploy"] });

    expect(() => synthesize(project)).toThrowError(
      expect.objectContaining({ code: "INVALID_COMPENSATION" }),
    );
  });

  it("whitespace-only compensation command raises INVALID_COMPENSATION", () => {
    const project = new Project("saga-ws");
    const pipeline = new Pipeline(project, "ci");
    new ShellStep(pipeline, "deploy", {
      command: "deploy.sh",
      compensation: { kind: "shell", command: "   " },
    });
    new Entry(pipeline, "push", { trigger: push(), roots: ["deploy"] });

    expect(() => synthesize(project)).toThrowError(
      expect.objectContaining({ code: "INVALID_COMPENSATION" }),
    );
  });
});
