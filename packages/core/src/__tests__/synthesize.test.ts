import { describe, it, expect } from "vitest";
import {
  Project,
  Pipeline,
  ShellStep,
  Entry,
  push,
  type Reference,
} from "@sverka/cdk";
import { synthesize, SynthesisError, type StepDefinition } from "../index.js";

describe("synthesize — basic", () => {
  it("empty Pipeline → DefinitionGraph with empty steps/entries", () => {
    const proj = new Project("myproj");
    new Pipeline(proj, "ci");
    const graph = synthesize(proj);
    expect(graph.project.id).toBe("myproj");
    expect(graph.project.pipelines.length).toBe(1);
    const pipeline = graph.project.pipelines[0]!;
    expect(pipeline.steps).toEqual([]);
    expect(pipeline.entries).toEqual([]);
  });

  it("ShellStep → StepDefinition with shell operation", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    new ShellStep(pipeline, "build", { command: "npm run build" });
    const graph = synthesize(proj);
    const step = graph.project.pipelines[0]?.steps[0];
    expect(step?.id).toBe("ci/build");
    expect(step?.operations[0]).toEqual({ kind: "shell", command: "npm run build" });
  });

  it("scalar output → exportOutput operation", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    new ShellStep(pipeline, "build", {
      command: "npm run build",
      outputs: { version: { type: "string" } },
    });
    const graph = synthesize(proj);
    const step = graph.project.pipelines[0]?.steps[0];
    expect(step?.operations).toContainEqual({
      kind: "exportOutput",
      name: "version",
      type: "string",
    });
  });

  it("artifact output → exportArtifact operation", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    new ShellStep(pipeline, "build", {
      command: "npm run build",
      outputs: { dist: { type: "artifact", path: "./dist" } },
    });
    const graph = synthesize(proj);
    const step = graph.project.pipelines[0]?.steps[0];
    expect(step?.operations).toContainEqual({
      kind: "exportArtifact",
      name: "dist",
      path: "./dist",
    });
  });

  it("artifact StepRef in inputs → importArtifact operation + artifact dependency", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    new ShellStep(pipeline, "build", {
      command: "npm run build",
      outputs: { dist: { type: "artifact", path: "./dist" } },
    });
    new ShellStep(pipeline, "test", {
      command: "npm test",
      inputs: [{ kind: "step", step: "build", output: "dist", type: "artifact" }],
    });
    const graph = synthesize(proj);
    const testStep = graph.project.pipelines[0]?.steps.find((s) => s.id === "ci/test");
    expect(testStep?.operations).toContainEqual({
      kind: "importArtifact",
      name: "dist",
      from: "ci/build",
      output: "dist",
    });
    expect(testStep?.dependencies).toContainEqual({
      kind: "artifact",
      producer: "ci/build",
      output: "dist",
    });
  });

  it("scalar StepRef in inputs → value dependency", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    new ShellStep(pipeline, "build", {
      command: "npm run build",
      outputs: { version: { type: "string" } },
    });
    new ShellStep(pipeline, "deploy", {
      command: "deploy",
      inputs: [{ kind: "step", step: "build", output: "version", type: "string" }],
    });
    const graph = synthesize(proj);
    const deployStep = graph.project.pipelines[0]?.steps.find((s) => s.id === "ci/deploy");
    expect(deployStep?.dependencies).toContainEqual({
      kind: "value",
      producer: "ci/build",
      output: "version",
    });
  });

  it("dependsOn → control dependency", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    new ShellStep(pipeline, "build", { command: "npm run build" });
    new ShellStep(pipeline, "test", {
      command: "npm test",
      dependsOn: ["build"],
    });
    const graph = synthesize(proj);
    const testStep = graph.project.pipelines[0]?.steps.find((s) => s.id === "ci/test");
    expect(testStep?.dependencies).toContainEqual({
      kind: "control",
      producer: "ci/build",
    });
  });

  it("uses already-prefixed step reference as-is", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    new ShellStep(pipeline, "build", {
      command: "npm run build",
      outputs: { dist: { type: "artifact", path: "./dist" } },
    });
    new ShellStep(pipeline, "test", {
      command: "npm test",
      inputs: [{ kind: "step", step: "ci/build", output: "dist", type: "artifact" }],
    });
    const graph = synthesize(proj);
    const testStep = graph.project.pipelines[0]?.steps.find((s) => s.id === "ci/test");
    expect(testStep?.operations).toContainEqual({
      kind: "importArtifact",
      name: "dist",
      from: "ci/build",
      output: "dist",
    });
    expect(testStep?.dependencies).toContainEqual({
      kind: "artifact",
      producer: "ci/build",
      output: "dist",
    });
  });

  it("deduplicates: same producer referenced twice → one dependency", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    new ShellStep(pipeline, "build", {
      command: "npm run build",
      outputs: {
        dist: { type: "artifact", path: "./dist" },
        version: { type: "string" },
      },
    });
    new ShellStep(pipeline, "test", {
      command: "npm test",
      inputs: [
        { kind: "step", step: "build", output: "dist", type: "artifact" },
        { kind: "step", step: "build", output: "version", type: "string" },
      ],
    });
    const graph = synthesize(proj);
    const testStep = graph.project.pipelines[0]?.steps.find((s) => s.id === "ci/test");
    // Two different outputs → two dependencies (artifact + value), not deduplicated.
    expect(testStep?.dependencies.length).toBe(2);
    // But referencing the same output twice should deduplicate.
    const proj2 = new Project("p2");
    const pipe2 = new Pipeline(proj2, "ci");
    new ShellStep(pipe2, "build", {
      command: "npm run build",
      outputs: { dist: { type: "artifact", path: "./dist" } },
    });
    new ShellStep(pipe2, "test", {
      command: "npm test",
      inputs: [
        { kind: "step", step: "build", output: "dist", type: "artifact" },
        { kind: "step", step: "build", output: "dist", type: "artifact" },
      ],
    });
    const graph2 = synthesize(proj2);
    const testStep2 = graph2.project.pipelines[0]?.steps.find((s) => s.id === "ci/test");
    expect(testStep2?.dependencies.length).toBe(1);
  });
});

describe("synthesize — conformance seed", () => {
  it("build → test → deploy with artifact + scalar transfer", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");

    new ShellStep(pipeline, "build", {
      command: "npm run build",
      outputs: {
        dist: { type: "artifact", path: "./dist" },
        version: { type: "string" },
      },
    });

    new ShellStep(pipeline, "test", {
      command: "npm test",
      inputs: [{ kind: "step", step: "build", output: "dist", type: "artifact" }],
      dependsOn: ["build"],
    });

    new ShellStep(pipeline, "deploy", {
      command: "deploy",
      inputs: [{ kind: "step", step: "build", output: "version", type: "string" }],
    });

    new Entry(pipeline, "on-push", {
      trigger: push(),
      roots: ["build"],
    });

    const graph = synthesize(proj);
    const p = graph.project.pipelines[0]!;

    // ci/build: shell + exportArtifact(dist) + exportOutput(version), no deps.
    const build = p.steps.find((s) => s.id === "ci/build")!;
    expect(build.operations).toEqual([
      { kind: "shell", command: "npm run build" },
      { kind: "exportArtifact", name: "dist", path: "./dist" },
      { kind: "exportOutput", name: "version", type: "string" },
    ]);
    expect(build.dependencies).toEqual([]);

    // ci/test: shell + importArtifact(dist from build), artifact dep.
    const test = p.steps.find((s) => s.id === "ci/test")!;
    expect(test.operations).toContainEqual({
      kind: "importArtifact",
      name: "dist",
      from: "ci/build",
      output: "dist",
    });
    // dependsOn + artifact ref to same producer → only artifact dep (more specific).
    expect(test.dependencies).toEqual([
      { kind: "artifact", producer: "ci/build", output: "dist" },
    ]);

    // ci/deploy: shell, value dep on version.
    const deploy = p.steps.find((s) => s.id === "ci/deploy")!;
    expect(deploy.operations).toEqual([{ kind: "shell", command: "deploy" }]);
    expect(deploy.dependencies).toEqual([
      { kind: "value", producer: "ci/build", output: "version" },
    ]);

    // Entry ci/on-push: trigger push, roots [ci/build].
    const entry = p.entries[0]!;
    expect(entry.id).toBe("ci/on-push");
    expect(entry.trigger.kind).toBe("push");
    expect(entry.roots).toEqual(["ci/build"]);
  });
});

describe("synthesize — determinism", () => {
  it("same construct tree synthesized twice → identical Definition Graph", () => {
    function buildTree(): Project {
      const proj = new Project("myproj");
      const pipeline = new Pipeline(proj, "ci");
      new ShellStep(pipeline, "build", {
        command: "npm run build",
        outputs: {
          dist: { type: "artifact", path: "./dist" },
          version: { type: "string" },
        },
      });
      new ShellStep(pipeline, "test", {
        command: "npm test",
        inputs: [{ kind: "step", step: "build", output: "dist", type: "artifact" }],
        dependsOn: ["build"],
      });
      new Entry(pipeline, "on-push", { trigger: push(), roots: ["build"] });
      return proj;
    }

    const g1 = synthesize(buildTree());
    const g2 = synthesize(buildTree());
    expect(JSON.stringify(g1)).toBe(JSON.stringify(g2));
  });
});

describe("synthesize — step conditions", () => {
  it("StepRef condition adds a value dependency", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    new ShellStep(pipeline, "build", {
      command: "npm run build",
      outputs: { ok: { type: "boolean" } },
    });
    new ShellStep(pipeline, "deploy", {
      command: "deploy",
      condition: {
        kind: "step",
        step: "build",
        output: "ok",
        type: "boolean",
      },
    });
    const graph = synthesize(proj);
    const deploy = graph.project.pipelines[0]?.steps.find(
      (s) => s.id === "ci/deploy",
    );
    expect(deploy?.dependencies).toContainEqual({
      kind: "value",
      producer: "ci/build",
      output: "ok",
    });
  });

  it("ContextRef condition does not add a dependency", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    const condition: Reference = {
      kind: "context",
      namespace: "env",
      field: "DEPLOY",
    };
    new ShellStep(pipeline, "build", { command: "npm run build" });
    new ShellStep(pipeline, "deploy", {
      command: "deploy",
      condition,
    });
    const graph = synthesize(proj);
    const deploy = graph.project.pipelines[0]?.steps.find(
      (s) => s.id === "ci/deploy",
    );
    expect(deploy?.dependencies).toEqual([]);
  });
});
