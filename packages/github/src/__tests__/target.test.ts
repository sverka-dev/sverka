import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import { Project, Pipeline, ShellStep, Entry } from "@sverka/constructs";
import { synthesize, type DefinitionGraph } from "@sverka/core";
import {
  GithubTarget,
  compileGithub,
  GithubTargetError,
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

describe("compileGithub — invalid graph handling", () => {
  it("throws INVALID_GRAPH for unknown entry root", () => {
    const graph: DefinitionGraph = {
      project: {
        id: "test",
        pipelines: [{
          id: "ci",
          inputs: {},
          entries: [{ id: "on-push", trigger: { kind: "push" }, roots: ["missing"] }],
          steps: [],
          outputs: [],
        }],
      },
    };
    expect(() => compileGithub(graph)).toThrow(GithubTargetError);
    try {
      compileGithub(graph);
    } catch (err) {
      expect((err as GithubTargetError).code).toBe("INVALID_GRAPH");
    }
  });

  it("throws INVALID_GRAPH for unknown dependency producer", () => {
    const graph: DefinitionGraph = {
      project: {
        id: "test",
        pipelines: [{
          id: "ci",
          inputs: {},
          entries: [{ id: "on-push", trigger: { kind: "push" }, roots: ["build"] }],
          steps: [{
            id: "build",
            runtime: { mode: "host" },
            operations: [{ kind: "shell", command: "echo hi" }],
            inputs: [],
            outputs: [],
            dependencies: [{ kind: "control", producer: "missing" }],
          }],
          outputs: [],
        }],
      },
    };
    expect(() => compileGithub(graph)).toThrow(GithubTargetError);
    try {
      compileGithub(graph);
    } catch (err) {
      expect((err as GithubTargetError).code).toBe("INVALID_GRAPH");
    }
  });
});

describe("compileGithub — diagnostic operation", () => {
  it("passes diagnostic message through step env", () => {
    const graph: DefinitionGraph = {
      project: {
        id: "test",
        pipelines: [{
          id: "ci",
          inputs: {},
          entries: [{ id: "on-push", trigger: { kind: "push" }, roots: ["build"] }],
          steps: [{
            id: "build",
            runtime: { mode: "host" },
            operations: [{ kind: "diagnostic", message: "hello", severity: "error" }],
            inputs: [],
            outputs: [],
            dependencies: [],
          }],
          outputs: [],
        }],
      },
    };
    const result = compileGithub(graph);
    const yaml = parse(result.artifacts[0]!.content);
    const runStep = yaml.jobs.build.steps.find((s: { run?: string }) => s.run);
    expect(runStep.env).toBeDefined();
    expect(runStep.env.SVERKA_DIAGNOSTIC_MESSAGE).toBe("hello");
    expect(runStep.run).toContain("::error::");
    expect(runStep.run).toContain("$SVERKA_DIAGNOSTIC_MESSAGE");
  });

  it("escapes percent, newlines, and carriage returns in diagnostic message", () => {
    const message = "50%\nline\rmore";
    const graph: DefinitionGraph = {
      project: {
        id: "test",
        pipelines: [{
          id: "ci",
          inputs: {},
          entries: [{ id: "on-push", trigger: { kind: "push" }, roots: ["build"] }],
          steps: [{
            id: "build",
            runtime: { mode: "host" },
            operations: [{ kind: "diagnostic", message, severity: "warn" }],
            inputs: [],
            outputs: [],
            dependencies: [],
          }],
          outputs: [],
        }],
      },
    };
    const result = compileGithub(graph);
    const yaml = parse(result.artifacts[0]!.content);
    const runStep = yaml.jobs.build.steps.find((s: { run?: string }) => s.run);
    expect(runStep.env.SVERKA_DIAGNOSTIC_MESSAGE).toBe(
      "50%25%0Aline%0Dmore",
    );
    expect(runStep.run).toContain("::warning::");
  });
});
