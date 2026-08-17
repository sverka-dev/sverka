import { describe, it, expect } from "vitest";
import { Project, Pipeline, ShellStep, Entry, push } from "@sverka/cdk";
import { synthesize } from "../synthesize.js";

describe("F-10: beforeScript/afterScript in synthesis", () => {
  it("carries beforeScript through to StepDefinition", () => {
    const project = new Project("test-before");
    const pipeline = new Pipeline(project, "ci");
    new ShellStep(pipeline, "test", {
      command: "make test",
      beforeScript: ["echo setup"],
    });
    new Entry(pipeline, "push", { trigger: push(), roots: ["test"] });

    const graph = synthesize(project);
    const step = graph.project.pipelines[0]!.steps.find((s) => s.id === "ci/test");
    expect(step?.beforeScript).toEqual(["echo setup"]);
  });

  it("carries afterScript through to StepDefinition", () => {
    const project = new Project("test-after");
    const pipeline = new Pipeline(project, "ci");
    new ShellStep(pipeline, "test", {
      command: "make test",
      afterScript: ["echo cleanup"],
    });
    new Entry(pipeline, "push", { trigger: push(), roots: ["test"] });

    const graph = synthesize(project);
    const step = graph.project.pipelines[0]!.steps.find((s) => s.id === "ci/test");
    expect(step?.afterScript).toEqual(["echo cleanup"]);
  });

  it("does not set beforeScript/afterScript when not provided", () => {
    const project = new Project("test-none");
    const pipeline = new Pipeline(project, "ci");
    new ShellStep(pipeline, "test", { command: "make test" });
    new Entry(pipeline, "push", { trigger: push(), roots: ["test"] });

    const graph = synthesize(project);
    const step = graph.project.pipelines[0]!.steps.find((s) => s.id === "ci/test");
    expect(step?.beforeScript).toBeUndefined();
    expect(step?.afterScript).toBeUndefined();
    expect("beforeScript" in step!).toBe(false);
    expect("afterScript" in step!).toBe(false);
  });
});

describe("F-12: continueOnError in synthesis", () => {
  it("carries boolean continueOnError through to StepDefinition", () => {
    const project = new Project("test-coe-bool");
    const pipeline = new Pipeline(project, "ci");
    new ShellStep(pipeline, "test", {
      command: "make test",
      continueOnError: true,
    });
    new Entry(pipeline, "push", { trigger: push(), roots: ["test"] });

    const graph = synthesize(project);
    const step = graph.project.pipelines[0]!.steps.find((s) => s.id === "ci/test");
    expect(step?.continueOnError).toBe(true);
  });

  it("carries exitCodes continueOnError through to StepDefinition", () => {
    const project = new Project("test-coe-codes");
    const pipeline = new Pipeline(project, "ci");
    new ShellStep(pipeline, "test", {
      command: "make test",
      continueOnError: { exitCodes: [1, 2] },
    });
    new Entry(pipeline, "push", { trigger: push(), roots: ["test"] });

    const graph = synthesize(project);
    const step = graph.project.pipelines[0]!.steps.find((s) => s.id === "ci/test");
    expect(step?.continueOnError).toEqual({ exitCodes: [1, 2] });
  });
});

describe("F-14: retry in synthesis", () => {
  it("carries retry policy through to StepDefinition", () => {
    const project = new Project("test-retry");
    const pipeline = new Pipeline(project, "ci");
    new ShellStep(pipeline, "test", {
      command: "make test",
      retry: { max: 3, when: ["timeout"] },
    });
    new Entry(pipeline, "push", { trigger: push(), roots: ["test"] });

    const graph = synthesize(project);
    const step = graph.project.pipelines[0]!.steps.find((s) => s.id === "ci/test");
    expect(step?.retry).toEqual({ max: 3, when: ["timeout"] });
  });
});
