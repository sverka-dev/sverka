import { describe, it, expect } from "vitest";
import { Project, Pipeline, ShellStep, Entry, push, schedule } from "@sverka/cdk";
import { synthesize } from "@sverka/core";
import { GitlabTarget } from "../target.js";

describe("GitLab F-05: schedule trigger lowering", () => {
  it("lowers schedule trigger to a schedule rule", () => {
    const project = new Project("gl-schedule-test");
    const pipeline = new Pipeline(project, "ci");
    new ShellStep(pipeline, "test", { command: "make test" });
    new Entry(pipeline, "nightly", { trigger: schedule("0 0 * * *"), roots: ["test"] });

    const graph = synthesize(project);
    const target = new GitlabTarget();
    const targetGraph = target.lower(graph);
    const job = targetGraph.jobs[0]!;
    expect(job.rules).toContainEqual({ if: '$CI_PIPELINE_SOURCE == "schedule"' });
  });
});

describe("GitLab F-10: beforeScript/afterScript lowering", () => {
  it("lowers beforeScript to before_script", () => {
    const project = new Project("gl-before");
    const pipeline = new Pipeline(project, "ci");
    new ShellStep(pipeline, "test", {
      command: "make test",
      beforeScript: ["echo setup"],
    });
    new Entry(pipeline, "push", { trigger: push(), roots: ["test"] });

    const graph = synthesize(project);
    const target = new GitlabTarget();
    const targetGraph = target.lower(graph);
    expect(targetGraph.jobs[0]!.beforeScript).toEqual(["echo setup"]);
  });

  it("lowers afterScript to after_script", () => {
    const project = new Project("gl-after");
    const pipeline = new Pipeline(project, "ci");
    new ShellStep(pipeline, "test", {
      command: "make test",
      afterScript: ["echo cleanup"],
    });
    new Entry(pipeline, "push", { trigger: push(), roots: ["test"] });

    const graph = synthesize(project);
    const target = new GitlabTarget();
    const targetGraph = target.lower(graph);
    expect(targetGraph.jobs[0]!.afterScript).toEqual(["echo cleanup"]);
  });
});

describe("GitLab F-12: continueOnError lowering", () => {
  it("lowers boolean continueOnError to allow_failure", () => {
    const project = new Project("gl-coe-bool");
    const pipeline = new Pipeline(project, "ci");
    new ShellStep(pipeline, "test", {
      command: "make test",
      continueOnError: true,
    });
    new Entry(pipeline, "push", { trigger: push(), roots: ["test"] });

    const graph = synthesize(project);
    const target = new GitlabTarget();
    const targetGraph = target.lower(graph);
    expect(targetGraph.jobs[0]!.allowFailure).toBe(true);
  });

  it("lowers exitCodes continueOnError to allow_failure with exit_codes", () => {
    const project = new Project("gl-coe-codes");
    const pipeline = new Pipeline(project, "ci");
    new ShellStep(pipeline, "test", {
      command: "make test",
      continueOnError: { exitCodes: [1, 2] },
    });
    new Entry(pipeline, "push", { trigger: push(), roots: ["test"] });

    const graph = synthesize(project);
    const target = new GitlabTarget();
    const targetGraph = target.lower(graph);
    expect(targetGraph.jobs[0]!.allowFailure).toEqual({ exitCodes: [1, 2] });
  });
});

describe("GitLab F-14: retry lowering", () => {
  it("lowers retry policy to retry object", () => {
    const project = new Project("gl-retry");
    const pipeline = new Pipeline(project, "ci");
    new ShellStep(pipeline, "test", {
      command: "make test",
      retry: { max: 3, when: ["timeout"], exitCodes: [1] },
    });
    new Entry(pipeline, "push", { trigger: push(), roots: ["test"] });

    const graph = synthesize(project);
    const target = new GitlabTarget();
    const targetGraph = target.lower(graph);
    expect(targetGraph.jobs[0]!.retry).toEqual({
      max: 3,
      when: ["timeout"],
      exitCodes: [1],
    });
  });

  it("emits retry in YAML", () => {
    const project = new Project("gl-retry-yaml");
    const pipeline = new Pipeline(project, "ci");
    new ShellStep(pipeline, "test", {
      command: "make test",
      retry: { max: 2 },
    });
    new Entry(pipeline, "push", { trigger: push(), roots: ["test"] });

    const graph = synthesize(project);
    const target = new GitlabTarget();
    const yaml = target.compile(graph).artifacts[0]!.content;
    expect(yaml).toContain("retry:");
    expect(yaml).toContain("max: 2");
  });
});
