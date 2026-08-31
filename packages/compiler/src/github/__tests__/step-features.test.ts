import { describe, it, expect } from "vitest";
import { Project, Pipeline, ShellStep, Entry, push, schedule } from "@sverka/workflow";
import { synthesize } from "@sverka/workflow";
import { GithubTarget } from "../target.js";
import { GithubTargetError } from "../errors.js";
import type { GithubTargetGraph } from "../types.js";

function singleGraph(result: GithubTargetGraph | readonly GithubTargetGraph[]): GithubTargetGraph {
  if ("jobs" in result) return result;
  return result[0]!;
}

describe("GitHub F-05: schedule trigger lowering", () => {
  it("lowers schedule trigger to on.schedule", () => {
    const project = new Project("gh-schedule-test");
    const pipeline = new Pipeline(project, "ci");
    new ShellStep(pipeline, "test", { command: "make test" });
    new Entry(pipeline, "nightly", { trigger: schedule("0 0 * * *"), roots: ["test"] });

    const graph = synthesize(project);
    const target = new GithubTarget();
    const targetGraph = singleGraph(target.lower(graph));
    expect(targetGraph.on.schedule).toBeDefined();
    expect(targetGraph.on.schedule).toEqual([{ cron: "0 0 * * *" }]);
  });

  it("lowers schedule trigger with timezone", () => {
    const project = new Project("gh-schedule-tz");
    const pipeline = new Pipeline(project, "ci");
    new ShellStep(pipeline, "test", { command: "make test" });
    new Entry(pipeline, "nightly", { trigger: schedule("0 0 * * *", "UTC"), roots: ["test"] });

    const graph = synthesize(project);
    const target = new GithubTarget();
    const targetGraph = singleGraph(target.lower(graph));
    expect(targetGraph.on.schedule).toEqual([{ cron: "0 0 * * *", timezone: "UTC" }]);
  });

  it("emits schedule in YAML", () => {
    const project = new Project("gh-schedule-yaml");
    const pipeline = new Pipeline(project, "ci");
    new ShellStep(pipeline, "test", { command: "make test" });
    new Entry(pipeline, "nightly", { trigger: schedule("0 0 * * *"), roots: ["test"] });

    const graph = synthesize(project);
    const target = new GithubTarget();
    const artifacts = target.compile(graph).artifacts;
    const yaml = artifacts[0]!.content;
    expect(yaml).toContain("schedule:");
    expect(yaml).toContain("cron: 0 0 * * *");
  });
});

describe("GitHub F-10: beforeScript/afterScript lowering", () => {
  it("lowers beforeScript to run steps before main operations", () => {
    const project = new Project("gh-before");
    const pipeline = new Pipeline(project, "ci");
    new ShellStep(pipeline, "test", {
      command: "make test",
      beforeScript: ["echo setup", "npm ci"],
    });
    new Entry(pipeline, "push", { trigger: push(), roots: ["test"] });

    const graph = synthesize(project);
    const target = new GithubTarget();
    const targetGraph = singleGraph(target.lower(graph));
    const job = targetGraph.jobs[0]!;
    const runSteps = job.steps.filter((s) => s.run !== undefined);
    expect(runSteps[0]!.run).toBe("echo setup");
    expect(runSteps[1]!.run).toBe("npm ci");
  });

  it("lowers afterScript to run steps with if: always()", () => {
    const project = new Project("gh-after");
    const pipeline = new Pipeline(project, "ci");
    new ShellStep(pipeline, "test", {
      command: "make test",
      afterScript: ["echo cleanup"],
    });
    new Entry(pipeline, "push", { trigger: push(), roots: ["test"] });

    const graph = synthesize(project);
    const target = new GithubTarget();
    const targetGraph = singleGraph(target.lower(graph));
    const job = targetGraph.jobs[0]!;
    const lastRunStep = job.steps[job.steps.length - 1]!;
    expect(lastRunStep.run).toBe("echo cleanup");
    expect(lastRunStep.if).toBe("always()");
  });
});

describe("GitHub F-12: continueOnError lowering", () => {
  it("lowers boolean continueOnError to continue-on-error on run steps", () => {
    const project = new Project("gh-coe-bool");
    const pipeline = new Pipeline(project, "ci");
    new ShellStep(pipeline, "test", {
      command: "make test",
      continueOnError: true,
    });
    new Entry(pipeline, "push", { trigger: push(), roots: ["test"] });

    const graph = synthesize(project);
    const target = new GithubTarget();
    const targetGraph = singleGraph(target.lower(graph));
    const job = targetGraph.jobs[0]!;
    const runStep = job.steps.find((s) => s.run !== undefined);
    expect(runStep?.continueOnError).toBe(true);
  });

  it("emits continue-on-error in YAML", () => {
    const project = new Project("gh-coe-yaml");
    const pipeline = new Pipeline(project, "ci");
    new ShellStep(pipeline, "test", {
      command: "make test",
      continueOnError: true,
    });
    new Entry(pipeline, "push", { trigger: push(), roots: ["test"] });

    const graph = synthesize(project);
    const target = new GithubTarget();
    const yaml = target.compile(graph).artifacts[0]!.content;
    expect(yaml).toContain("continue-on-error: true");
  });

  it("rejects exit-code continueOnError with GithubTargetError", () => {
    const project = new Project("gh-coe-codes");
    const pipeline = new Pipeline(project, "ci");
    new ShellStep(pipeline, "test", {
      command: "make test",
      continueOnError: { exitCodes: [1, 2] },
    });
    new Entry(pipeline, "push", { trigger: push(), roots: ["test"] });

    const graph = synthesize(project);
    const target = new GithubTarget();
    expect(() => target.lower(graph)).toThrow(GithubTargetError);
    expect(() => target.lower(graph)).toThrow(/exit-code continueOnError/);
  });
});
