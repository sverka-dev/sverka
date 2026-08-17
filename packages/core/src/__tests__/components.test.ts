import { describe, it, expect } from "vitest";
import {
  Project,
  Pipeline,
  ShellStep,
  ComponentStep,
  ChildPipelineStep,
  DownstreamStep,
  ReleaseStep,
  PagesStep,
  Entry,
  push,
} from "@sverka/cdk";
import { synthesize, type StepDefinition } from "../index.js";

describe("component synthesis", () => {
  it("synthesizes a component step with component ref", () => {
    const proj = new Project("test");
    const ci = new Pipeline(proj, "ci");
    new ShellStep(ci, "build", { command: "make build" });
    new ComponentStep(ci, "deploy", {
      component: { name: "deploy", version: "1.0.0", inputs: { env: "staging" } },
      dependsOn: ["build"],
    });
    new Entry(ci, "on-push", { trigger: push(), roots: ["deploy"] });

    const graph = synthesize(proj);
    const ciPipeline = graph.project.pipelines.find((p) => p.id === "ci")!;
    const deployStep = ciPipeline.steps.find((s) => s.id === "ci/deploy");
    expect(deployStep).toBeDefined();
    expect(deployStep!.component).toBeDefined();
    expect(deployStep!.component!.name).toBe("deploy");
    expect(deployStep!.component!.version).toBe("1.0.0");
    expect(deployStep!.component!.inputs.env).toBe("staging");
    // No shell operations on a component step.
    expect(deployStep!.operations).toHaveLength(0);
  });

  it("component step with Reference input binding", () => {
    const proj = new Project("test");
    const ci = new Pipeline(proj, "ci");
    new ShellStep(ci, "build", {
      command: "make build",
      outputs: { version: { type: "string" } },
    });
    new ComponentStep(ci, "deploy", {
      component: {
        name: "deploy",
        version: "1.0.0",
        inputs: {
          version: { kind: "step", step: "build", output: "version", type: "string" },
        },
      },
      dependsOn: ["build"],
    });
    new Entry(ci, "on-push", { trigger: push(), roots: ["deploy"] });

    const graph = synthesize(proj);
    const deployStep = graph.project.pipelines
      .find((p) => p.id === "ci")!
      .steps.find((s) => s.id === "ci/deploy");
    expect(deployStep!.component!.inputs.version).toEqual({
      kind: "step",
      step: "build",
      output: "version",
      type: "string",
    });
  });

  it("component step preserves dependsOn", () => {
    const proj = new Project("test");
    const ci = new Pipeline(proj, "ci");
    new ShellStep(ci, "build", { command: "make build" });
    new ComponentStep(ci, "deploy", {
      component: { name: "deploy", version: "1.0.0", inputs: {} },
      dependsOn: ["build"],
    });
    new Entry(ci, "on-push", { trigger: push(), roots: ["deploy"] });

    const graph = synthesize(proj);
    const deployStep = graph.project.pipelines
      .find((p) => p.id === "ci")!
      .steps.find((s) => s.id === "ci/deploy");
    expect(deployStep!.dependencies).toEqual([
      { kind: "control", producer: "ci/build" },
    ]);
  });
});

describe("child pipeline synthesis", () => {
  it("synthesizes a child pipeline step with trigger ref", () => {
    const proj = new Project("test");
    const ci = new Pipeline(proj, "ci");
    new ShellStep(ci, "generate", {
      command: "generate-pipeline > child.yml",
      outputs: { "child-pipeline": { type: "artifact", path: "child.yml" } },
    });
    new ChildPipelineStep(ci, "trigger-child", {
      childPipeline: { generator: "generate", artifact: "child-pipeline" },
      dependsOn: ["generate"],
    });
    new Entry(ci, "on-push", { trigger: push(), roots: ["trigger-child"] });

    const graph = synthesize(proj);
    const ciPipeline = graph.project.pipelines.find((p) => p.id === "ci")!;
    const triggerStep = ciPipeline.steps.find((s) => s.id === "ci/trigger-child");
    expect(triggerStep).toBeDefined();
    expect(triggerStep!.childPipeline).toBeDefined();
    expect(triggerStep!.childPipeline!.generator).toBe("generate");
    expect(triggerStep!.childPipeline!.artifact).toBe("child-pipeline");
    expect(triggerStep!.operations).toHaveLength(0);
  });

  it("child pipeline step preserves dependsOn", () => {
    const proj = new Project("test");
    const ci = new Pipeline(proj, "ci");
    new ShellStep(ci, "generate", {
      command: "generate-pipeline > child.yml",
      outputs: { "child-pipeline": { type: "artifact", path: "child.yml" } },
    });
    new ChildPipelineStep(ci, "trigger-child", {
      childPipeline: { generator: "generate", artifact: "child-pipeline" },
      dependsOn: ["generate"],
    });
    new Entry(ci, "on-push", { trigger: push(), roots: ["trigger-child"] });

    const graph = synthesize(proj);
    const triggerStep = graph.project.pipelines
      .find((p) => p.id === "ci")!
      .steps.find((s) => s.id === "ci/trigger-child");
    expect(triggerStep!.dependencies).toEqual([
      { kind: "control", producer: "ci/generate" },
    ]);
  });
});

describe("downstream synthesis", () => {
  it("synthesizes a downstream step with trigger ref", () => {
    const proj = new Project("test");
    const ci = new Pipeline(proj, "ci");
    new ShellStep(ci, "build", { command: "make build" });
    new DownstreamStep(ci, "trigger-downstream", {
      downstream: { project: "group/other-project", branch: "main", inputs: { env: "staging" } },
      dependsOn: ["build"],
    });
    new Entry(ci, "on-push", { trigger: push(), roots: ["trigger-downstream"] });

    const graph = synthesize(proj);
    const ciPipeline = graph.project.pipelines.find((p) => p.id === "ci")!;
    const dsStep = ciPipeline.steps.find((s) => s.id === "ci/trigger-downstream");
    expect(dsStep).toBeDefined();
    expect(dsStep!.downstream).toBeDefined();
    expect(dsStep!.downstream!.project).toBe("group/other-project");
    expect(dsStep!.downstream!.branch).toBe("main");
    expect(dsStep!.downstream!.inputs?.env).toBe("staging");
    expect(dsStep!.operations).toHaveLength(0);
  });
});

describe("release synthesis", () => {
  it("synthesizes a release step with release operation", () => {
    const proj = new Project("test");
    const ci = new Pipeline(proj, "ci");
    new ShellStep(ci, "build", { command: "make build" });
    new ReleaseStep(ci, "release", {
      release: {
        tag: "v1.0.0",
        name: "Release v1.0.0",
        description: "Release notes",
        assets: ["dist/bin.tar.gz"],
      },
      dependsOn: ["build"],
    });
    new Entry(ci, "on-push", { trigger: push(), roots: ["release"] });

    const graph = synthesize(proj);
    const ciPipeline = graph.project.pipelines.find((p) => p.id === "ci")!;
    const releaseStep = ciPipeline.steps.find((s) => s.id === "ci/release");
    expect(releaseStep).toBeDefined();
    // Should have a release operation.
    const releaseOp = releaseStep!.operations.find((o) => o.kind === "release");
    expect(releaseOp).toBeDefined();
    expect(releaseOp!.kind).toBe("release");
    if (releaseOp!.kind === "release") {
      expect(releaseOp!.tag).toBe("v1.0.0");
      expect(releaseOp!.name).toBe("Release v1.0.0");
      expect(releaseOp!.assets).toEqual(["dist/bin.tar.gz"]);
    }
  });
});

describe("pages synthesis", () => {
  it("synthesizes a pages step with deployPages operation", () => {
    const proj = new Project("test");
    const ci = new Pipeline(proj, "ci");
    new ShellStep(ci, "build", { command: "make build" });
    new PagesStep(ci, "deploy-pages", {
      pages: { path: "dist/", prefix: "project-name" },
      dependsOn: ["build"],
    });
    new Entry(ci, "on-push", { trigger: push(), roots: ["deploy-pages"] });

    const graph = synthesize(proj);
    const ciPipeline = graph.project.pipelines.find((p) => p.id === "ci")!;
    const pagesStep = ciPipeline.steps.find((s) => s.id === "ci/deploy-pages");
    expect(pagesStep).toBeDefined();
    const pagesOp = pagesStep!.operations.find((o) => o.kind === "deployPages");
    expect(pagesOp).toBeDefined();
    if (pagesOp!.kind === "deployPages") {
      expect(pagesOp!.path).toBe("dist/");
      expect(pagesOp!.prefix).toBe("project-name");
    }
  });
});

describe("workflow rules synthesis (F-42)", () => {
  it("synthesizes pipeline rules into PipelineDefinition", () => {
    const proj = new Project("test");
    const ci = new Pipeline(proj, "ci", {
      rules: [
        { if: "$CI_COMMIT_BRANCH == \"main\"", variables: { DEPLOY_TARGET: "production" } },
        { when: "never" },
      ],
    });
    new ShellStep(ci, "build", { command: "make build" });
    new Entry(ci, "on-push", { trigger: push(), roots: ["build"] });

    const graph = synthesize(proj);
    const ciPipeline = graph.project.pipelines.find((p) => p.id === "ci")!;
    expect(ciPipeline.rules).toBeDefined();
    expect(ciPipeline.rules).toHaveLength(2);
    expect(ciPipeline.rules![0]!.if).toBe("$CI_COMMIT_BRANCH == \"main\"");
    expect(ciPipeline.rules![1]!.when).toBe("never");
  });

  it("omits rules when pipeline has none", () => {
    const proj = new Project("test");
    const ci = new Pipeline(proj, "ci");
    new ShellStep(ci, "build", { command: "make build" });
    new Entry(ci, "on-push", { trigger: push(), roots: ["build"] });

    const graph = synthesize(proj);
    const ciPipeline = graph.project.pipelines.find((p) => p.id === "ci")!;
    expect(ciPipeline.rules).toBeUndefined();
  });
});

describe("includes synthesis (F-44)", () => {
  it("synthesizes pipeline includes into PipelineDefinition", () => {
    const proj = new Project("test");
    const ci = new Pipeline(proj, "ci", {
      includes: [
        { path: "templates/build.yml", inputs: { image: "node:24" } },
      ],
    });
    new ShellStep(ci, "build", { command: "make build" });
    new Entry(ci, "on-push", { trigger: push(), roots: ["build"] });

    const graph = synthesize(proj);
    const ciPipeline = graph.project.pipelines.find((p) => p.id === "ci")!;
    expect(ciPipeline.includes).toBeDefined();
    expect(ciPipeline.includes).toHaveLength(1);
    expect(ciPipeline.includes![0]!.path).toBe("templates/build.yml");
  });

  it("omits includes when pipeline has none", () => {
    const proj = new Project("test");
    const ci = new Pipeline(proj, "ci");
    new ShellStep(ci, "build", { command: "make build" });
    new Entry(ci, "on-push", { trigger: push(), roots: ["build"] });

    const graph = synthesize(proj);
    const ciPipeline = graph.project.pipelines.find((p) => p.id === "ci")!;
    expect(ciPipeline.includes).toBeUndefined();
  });
});

describe("delay synthesis (F-48)", () => {
  it("synthesizes step delay into StepDefinition", () => {
    const proj = new Project("test");
    const ci = new Pipeline(proj, "ci");
    new ShellStep(ci, "deploy", { command: "make deploy", delay: "5m" });
    new Entry(ci, "on-push", { trigger: push(), roots: ["deploy"] });

    const graph = synthesize(proj);
    const ciPipeline = graph.project.pipelines.find((p) => p.id === "ci")!;
    const deployStep = ciPipeline.steps.find((s) => s.id === "ci/deploy");
    expect(deployStep).toBeDefined();
    expect(deployStep!.delay).toBe("5m");
  });

  it("omits delay when not specified", () => {
    const proj = new Project("test");
    const ci = new Pipeline(proj, "ci");
    new ShellStep(ci, "build", { command: "make build" });
    new Entry(ci, "on-push", { trigger: push(), roots: ["build"] });

    const graph = synthesize(proj);
    const ciPipeline = graph.project.pipelines.find((p) => p.id === "ci")!;
    const buildStep = ciPipeline.steps.find((s) => s.id === "ci/build");
    expect(buildStep!.delay).toBeUndefined();
  });
});

describe("background execution synthesis (F-49)", () => {
  it("synthesizes background shell operation", () => {
    const proj = new Project("test");
    const ci = new Pipeline(proj, "ci");
    new ShellStep(ci, "start-server", { command: "npm start", background: true });
    new Entry(ci, "on-push", { trigger: push(), roots: ["start-server"] });

    const graph = synthesize(proj);
    const ciPipeline = graph.project.pipelines.find((p) => p.id === "ci")!;
    const serverStep = ciPipeline.steps.find((s) => s.id === "ci/start-server");
    const shellOp = serverStep!.operations.find((o) => o.kind === "shell");
    expect(shellOp).toBeDefined();
    if (shellOp!.kind === "shell") {
      expect(shellOp!.background).toBe(true);
    }
  });

  it("defaults background to false", () => {
    const proj = new Project("test");
    const ci = new Pipeline(proj, "ci");
    new ShellStep(ci, "build", { command: "make build" });
    new Entry(ci, "on-push", { trigger: push(), roots: ["build"] });

    const graph = synthesize(proj);
    const ciPipeline = graph.project.pipelines.find((p) => p.id === "ci")!;
    const buildStep = ciPipeline.steps.find((s) => s.id === "ci/build");
    const shellOp = buildStep!.operations.find((o) => o.kind === "shell");
    if (shellOp!.kind === "shell") {
      expect(shellOp!.background).toBeUndefined();
    }
  });
});
