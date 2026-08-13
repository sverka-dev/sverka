import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import { Project, Pipeline, ShellStep, Entry } from "@sverka/constructs";
import { synthesize } from "@sverka/core";
import {
  GithubTarget,
  compileGithub,
  type GithubTargetGraph,
  type GithubJob,
} from "../index.js";

function makeSimpleGraph(): ReturnType<typeof synthesize> {
  const proj = new Project("test");
  const p = new Pipeline(proj, "ci");
  new ShellStep(p, "build", { command: "npm run build" });
  new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
  return synthesize(proj);
}

function makeGraphWithDeps(): ReturnType<typeof synthesize> {
  const proj = new Project("test");
  const p = new Pipeline(proj, "ci");
  new ShellStep(p, "lint", { command: "npm run lint" });
  new ShellStep(p, "build", {
    command: "npm run build",
    dependsOn: ["lint"],
  });
  new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
  return synthesize(proj);
}

describe("compileGithub — basic", () => {
  it("produces one YAML artifact", () => {
    const graph = makeSimpleGraph();
    const result = compileGithub(graph);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]?.path).toBe(".github/workflows/ci.yml");
    expect(result.artifacts[0]?.content).toContain("name: ci");
  });

  it("produces valid YAML", () => {
    const graph = makeSimpleGraph();
    const result = compileGithub(graph);
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.name).toBe("ci");
    expect(yaml.jobs).toBeDefined();
  });
});

describe("compileGithub — shell operations", () => {
  it("maps shell operation to run step", () => {
    const graph = makeSimpleGraph();
    const result = compileGithub(graph);
    const yaml = parse(result.artifacts[0]!.content);
    const buildJob = yaml.jobs.build;
    expect(buildJob).toBeDefined();
    const runStep = buildJob.steps.find((s: { run?: string }) => s.run);
    expect(runStep).toBeDefined();
    expect(runStep.run).toBe("npm run build");
  });
});

describe("compileGithub — dependencies", () => {
  it("maps step dependencies to job needs", () => {
    const graph = makeGraphWithDeps();
    const result = compileGithub(graph);
    const yaml = parse(result.artifacts[0]!.content);
    const buildJob = yaml.jobs.build;
    expect(buildJob.needs).toBe("lint");
  });

  it("maps multiple dependencies to needs array", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "lint", { command: "npm run lint" });
    new ShellStep(p, "test", { command: "npm run test" });
    new ShellStep(p, "build", {
      command: "npm run build",
      dependsOn: ["lint", "test"],
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.jobs.build.needs).toEqual(["lint", "test"]);
  });
});

describe("compileGithub — trigger mapping", () => {
  it("maps push trigger", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi" });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.on.push).toBeDefined();
  });

  it("maps changeRequest trigger to pull_request", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi" });
    new Entry(p, "on-pr", { trigger: { kind: "changeRequest" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.on.pull_request).toBeDefined();
  });

  it("maps manual trigger to workflow_dispatch", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi" });
    new Entry(p, "on-manual", { trigger: { kind: "manual" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.on.workflow_dispatch).toBeNull();
  });

  it("maps multiple triggers", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi" });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    new Entry(p, "on-pr", { trigger: { kind: "changeRequest" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.on.push).toBeDefined();
    expect(yaml.on.pull_request).toBeDefined();
  });
});

describe("compileGithub — runtime mapping", () => {
  it("host runtime → ubuntu-latest", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo", runtime: { mode: "host" } });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.jobs.build["runs-on"]).toBe("ubuntu-latest");
  });

  it("container runtime → container field", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "echo",
      runtime: { mode: "container", image: "node:22" },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.jobs.build.container).toBe("node:22");
  });
});

describe("compileGithub — timeout", () => {
  it("maps timeout to timeout-minutes", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo", timeout: 600000 });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.jobs.build["timeout-minutes"]).toBe(10);
  });
});

describe("compileGithub — deterministic output", () => {
  it("same graph produces same YAML", () => {
    const g1 = makeSimpleGraph();
    const g2 = makeSimpleGraph();
    const r1 = compileGithub(g1);
    const r2 = compileGithub(g2);
    expect(r1.artifacts[0]?.content).toBe(r2.artifacts[0]?.content);
  });
});

describe("GithubTarget — analyze", () => {
  it("no diagnostics for all-native graph", () => {
    const graph = makeSimpleGraph();
    const target = new GithubTarget();
    const diags = target.analyze(graph);
    expect(diags).toHaveLength(0);
  });
});

describe("GithubTarget — lower", () => {
  it("produces correct job count", () => {
    const graph = makeGraphWithDeps();
    const target = new GithubTarget();
    const targetGraph = target.lower(graph);
    expect(targetGraph.jobs).toHaveLength(2);
  });

  it("job IDs match step IDs", () => {
    const graph = makeGraphWithDeps();
    const target = new GithubTarget();
    const targetGraph = target.lower(graph);
    const ids = targetGraph.jobs.map((j: GithubJob) => j.id);
    expect(ids).toEqual(["lint", "build"]);
  });
});

describe("GithubTarget — emit", () => {
  it("produces YAML artifact", () => {
    const graph = makeSimpleGraph();
    const target = new GithubTarget();
    const targetGraph = target.lower(graph);
    const artifacts = target.emit(targetGraph);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.content).toContain("jobs:");
  });
});
