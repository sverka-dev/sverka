import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import { Project, Pipeline, ShellStep, Entry } from "@sverka/cdk";
import { synthesize, type DefinitionGraph } from "@sverka/core";
import { GitlabTarget, compileGitlab, GitlabTargetError, type GitlabJob } from "../index.js";

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

describe("compileGitlab — basic", () => {
  it("produces one YAML artifact", () => {
    const graph = makeSimpleGraph();
    const result = compileGitlab(graph);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]?.path).toBe(".gitlab-ci.yml");
    expect(result.artifacts[0]?.content).toContain("stages:");
  });

  it("produces valid YAML", () => {
    const graph = makeSimpleGraph();
    const result = compileGitlab(graph);
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.stages).toBeDefined();
    expect(yaml.build).toBeDefined();
  });
});

describe("compileGitlab — shell operations", () => {
  it("maps shell operation to script entry", () => {
    const graph = makeSimpleGraph();
    const result = compileGitlab(graph);
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.script).toEqual(["npm run build"]);
  });
});

describe("compileGitlab — dependencies", () => {
  it("maps step dependencies to job needs", () => {
    const graph = makeGraphWithDeps();
    const result = compileGitlab(graph);
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.needs).toEqual(["lint"]);
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
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.needs).toEqual(["lint", "test"]);
  });
});

describe("compileGitlab — trigger mapping", () => {
  it("maps push trigger", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi" });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.rules[0].if).toContain('"push"');
  });

  it("maps changeRequest trigger to merge_request_event", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi" });
    new Entry(p, "on-pr", { trigger: { kind: "changeRequest" }, roots: ["build"] });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.rules[0].if).toContain("merge_request_event");
  });

  it("maps manual trigger to web source without when: manual", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi" });
    new Entry(p, "on-manual", { trigger: { kind: "manual" }, roots: ["build"] });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.rules[0].if).toContain('"web"');
    expect(yaml.build.rules[0].when).toBeUndefined();
  });

  it("maps multiple triggers to multiple rules", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi" });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    new Entry(p, "on-pr", { trigger: { kind: "changeRequest" }, roots: ["build"] });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.rules).toHaveLength(2);
  });
});

describe("compileGitlab — runtime mapping", () => {
  it("host runtime → no image", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo", runtime: { mode: "host" } });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.image).toBeUndefined();
  });

  it("container runtime → image field", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "echo",
      runtime: { mode: "container", image: "node:22" },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.image).toBe("node:22");
  });
});

describe("compileGitlab — timeout", () => {
  it("maps timeout to timeout string", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo", timeout: 600000 });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.timeout).toBe("10m");
  });
});

describe("compileGitlab — stages", () => {
  it("assigns build stage to steps with no deps", () => {
    const graph = makeSimpleGraph();
    const result = compileGitlab(graph);
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.stage).toBe("build");
  });

  it("assigns stage-1 to steps with one level of deps", () => {
    const graph = makeGraphWithDeps();
    const result = compileGitlab(graph);
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.lint.stage).toBe("build");
    expect(yaml.build.stage).toBe("stage-1");
  });
});

describe("compileGitlab — deterministic output", () => {
  it("same graph produces same YAML", () => {
    const g1 = makeSimpleGraph();
    const g2 = makeSimpleGraph();
    const r1 = compileGitlab(g1);
    const r2 = compileGitlab(g2);
    expect(r1.artifacts[0]?.content).toBe(r2.artifacts[0]?.content);
  });
});

describe("GitlabTarget — analyze", () => {
  it("no diagnostics for all-native graph", () => {
    const graph = makeSimpleGraph();
    const target = new GitlabTarget();
    const diags = target.analyze(graph);
    expect(diags).toHaveLength(0);
  });
});

describe("GitlabTarget — lower", () => {
  it("produces correct job count", () => {
    const graph = makeGraphWithDeps();
    const target = new GitlabTarget();
    const targetGraph = target.lower(graph);
    expect(targetGraph.jobs).toHaveLength(2);
  });

  it("job IDs match step IDs", () => {
    const graph = makeGraphWithDeps();
    const target = new GitlabTarget();
    const targetGraph = target.lower(graph);
    const ids = targetGraph.jobs.map((j: GitlabJob) => j.id);
    expect(ids).toEqual(["lint", "build"]);
  });
});

describe("GitlabTarget — emit", () => {
  it("produces YAML artifact", () => {
    const graph = makeSimpleGraph();
    const target = new GitlabTarget();
    const targetGraph = target.lower(graph);
    const artifacts = target.emit(targetGraph);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.content).toContain("script:");
  });
});

describe("compileGitlab — rule scoping", () => {
  it("scopes rules to jobs reachable from each entry", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo build" });
    new ShellStep(p, "deploy", { command: "echo deploy" });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    new Entry(p, "on-manual", {
      trigger: { kind: "manual" },
      roots: ["deploy"],
    });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.rules).toHaveLength(1);
    expect(yaml.build.rules[0]?.if).toContain('"push"');
    expect(yaml.deploy.rules).toHaveLength(1);
    expect(yaml.deploy.rules[0]?.if).toContain('"web"');
  });
});

describe("compileGitlab — artifact imports", () => {
  it("includes artifact-import producers in reachability and needs", () => {
    const graph: DefinitionGraph = {
      project: {
        id: "test",
        pipelines: [{
          id: "ci",
          inputs: {},
          entries: [{ id: "on-push", trigger: { kind: "push" }, roots: ["deploy"] }],
          steps: [
            {
              id: "build",
              runtime: { mode: "host" },
              operations: [{ kind: "exportArtifact", name: "dist", path: "dist" }],
              inputs: [],
              outputs: [],
              dependencies: [],
            },
            {
              id: "deploy",
              runtime: { mode: "host" },
              operations: [{ kind: "importArtifact", name: "dist", from: "build", output: "dist" }],
              inputs: [],
              outputs: [],
              dependencies: [],
            },
          ],
          outputs: [],
        }],
      },
    };
    const result = compileGitlab(graph);
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build).toBeDefined();
    expect(yaml.deploy.needs).toContain("build");
  });

  it("throws INVALID_GRAPH for unknown artifact-import producer", () => {
    const graph: DefinitionGraph = {
      project: {
        id: "test",
        pipelines: [{
          id: "ci",
          inputs: {},
          entries: [{ id: "on-push", trigger: { kind: "push" }, roots: ["deploy"] }],
          steps: [{
            id: "deploy",
            runtime: { mode: "host" },
            operations: [{ kind: "importArtifact", name: "dist", from: "missing", output: "dist" }],
            inputs: [],
            outputs: [],
            dependencies: [],
          }],
          outputs: [],
        }],
      },
    };
    expect(() => compileGitlab(graph)).toThrow(GitlabTargetError);
    try {
      compileGitlab(graph);
    } catch (err) {
      expect((err as GitlabTargetError).code).toBe("INVALID_GRAPH");
    }
  });
});

describe("compileGitlab — emission validation", () => {
  it("throws EMIT_FAILED for job id conflicting with reserved top-level key", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "image", { command: "echo hi" });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["image"] });
    expect(() => compileGitlab(synthesize(proj))).toThrow(GitlabTargetError);
    try {
      compileGitlab(synthesize(proj));
    } catch (err) {
      expect((err as GitlabTargetError).code).toBe("EMIT_FAILED");
    }
  });
});
