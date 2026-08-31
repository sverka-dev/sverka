import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import { Project, Pipeline, ShellStep, Entry, type DefinitionGraph } from "@sverka/workflow";
import { synthesize } from "@sverka/workflow";
import { compileDrone, DroneTarget, DroneTargetError } from "../index.js";

function makeSimpleGraph(): DefinitionGraph {
  const proj = new Project("test");
  const p = new Pipeline(proj, "ci");
  new ShellStep(p, "build", { command: "bun run build" });
  new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
  return synthesize(proj);
}

function makeGraphWithDeps(): DefinitionGraph {
  const proj = new Project("test");
  const p = new Pipeline(proj, "ci");
  new ShellStep(p, "lint", { command: "bun run lint" });
  new ShellStep(p, "build", { command: "bun run build", dependsOn: ["lint"] });
  new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
  return synthesize(proj);
}

function makeDiamondGraph(): DefinitionGraph {
  const proj = new Project("test");
  const p = new Pipeline(proj, "ci");
  new ShellStep(p, "lint", { command: "bun run lint" });
  new ShellStep(p, "test", { command: "bun run test" });
  new ShellStep(p, "build", { command: "bun run build", dependsOn: ["lint", "test"] });
  new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
  return synthesize(proj);
}

describe("compileDrone — basic", () => {
  it("produces one YAML artifact", () => {
    const result = compileDrone(makeSimpleGraph());
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]?.path).toBe(".drone.yml");
  });

  it("produces valid YAML", () => {
    const result = compileDrone(makeSimpleGraph());
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.kind).toBe("pipeline");
    expect(yaml.type).toBe("docker");
    expect(yaml.steps).toBeDefined();
  });
});

describe("compileDrone — shell operations", () => {
  it("maps shell operation to commands array", () => {
    const result = compileDrone(makeSimpleGraph());
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.steps[0].commands).toEqual(["bun run build"]);
  });
});

describe("compileDrone — dependencies", () => {
  it("maps step dependencies to depends_on", () => {
    const result = compileDrone(makeGraphWithDeps());
    const yaml = parse(result.artifacts[0]!.content);
    const buildStep = yaml.steps.find((s: { name: string }) => s.name === "build");
    expect(buildStep.depends_on).toEqual(["lint"]);
  });

  it("maps diamond dependencies correctly", () => {
    const result = compileDrone(makeDiamondGraph());
    const yaml = parse(result.artifacts[0]!.content);
    const buildStep = yaml.steps.find((s: { name: string }) => s.name === "build");
    expect(buildStep.depends_on).toEqual(["lint", "test"]);
  });
});

describe("compileDrone — trigger mapping", () => {
  it("maps push trigger to branch trigger", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi" });
    new Entry(p, "on-push", {
      trigger: { kind: "push", filter: { branches: ["main"] } },
      roots: ["build"],
    });
    const result = compileDrone(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.trigger.event).toContain("push");
    expect(yaml.trigger.branch).toContain("main");
  });

  it("maps changeRequest trigger to pull_request event", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi" });
    new Entry(p, "on-pr", { trigger: { kind: "changeRequest" }, roots: ["build"] });
    const result = compileDrone(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.trigger.event).toContain("pull_request");
  });

  it("maps manual trigger to custom event", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi" });
    new Entry(p, "on-manual", { trigger: { kind: "manual" }, roots: ["build"] });
    const result = compileDrone(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.trigger.event).toContain("custom");
    expect(yaml.trigger.custom).toBe(true);
  });

  it("maps schedule trigger to cron", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi" });
    new Entry(p, "on-schedule", { trigger: { kind: "schedule", cron: "0 * * * *" }, roots: ["build"] });
    const result = compileDrone(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.trigger.event).toContain("cron");
    expect(yaml.trigger.cron).toContain("0 * * * *");
  });
});

describe("compileDrone — runtime", () => {
  it("maps container runtime to image field", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "echo hi",
      runtime: { mode: "container", image: "golang:1.24" },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileDrone(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.steps[0].image).toBe("golang:1.24");
  });

  it("emulates host runtime with default image", () => {
    const result = compileDrone(makeSimpleGraph());
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.steps[0].image).toBe("node:24");
  });

  it("honors custom default image via config", () => {
    const result = compileDrone(makeSimpleGraph(), { image: "bun:latest" });
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.steps[0].image).toBe("bun:latest");
  });
});

describe("compileDrone — timeout", () => {
  it("maps timeout to seconds in step", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi", timeout: 60000 });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileDrone(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.steps[0].timeout).toBe(60);
  });
});

describe("compileDrone — unsupported features (diagnostics)", () => {
  it("emits diagnostic for conditions (unsupported)", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "echo hi",
      condition: { kind: "status", status: "failure" },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileDrone(synthesize(proj));
    expect(result.diagnostics.some((d) => d.capability === "graph.conditions")).toBe(true);
  });

  it("emits diagnostic for matrix (unsupported)", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "echo hi",
      matrix: { dimensions: { node: ["18", "20"] } },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileDrone(synthesize(proj));
    expect(result.diagnostics.some((d) => d.capability === "graph.matrix")).toBe(true);
  });

  it("emits diagnostic for scalar output (unsupported)", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "echo hi",
      outputs: { version: { type: "string" } },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileDrone(synthesize(proj));
    expect(result.diagnostics.some((d) => d.capability === "output.scalar")).toBe(true);
  });
});

describe("compileDrone — errors", () => {
  it("throws INVALID_GRAPH for empty graph", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    // No steps, no entries
    synthesize(proj);
    expect(() => compileDrone(synthesize(proj))).toThrow(DroneTargetError);
    expect(() => compileDrone(synthesize(proj))).toThrow(/no root pipelines/);
  });
});

describe("compileDrone — determinism", () => {
  it("same graph → identical output", () => {
    const g1 = makeSimpleGraph();
    const g2 = makeSimpleGraph();
    const r1 = compileDrone(g1);
    const r2 = compileDrone(g2);
    expect(r1.artifacts[0]?.content).toBe(r2.artifacts[0]?.content);
  });
});

describe("compileDrone — DroneTarget class", () => {
  it("exposes name and capabilities", () => {
    const target = new DroneTarget();
    expect(target.name).toBe("drone");
    expect(target.capabilities["trigger.push"]).toBe("native");
  });

  it("honors type config (kubernetes)", () => {
    const result = compileDrone(makeSimpleGraph(), { type: "kubernetes" });
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.type).toBe("kubernetes");
  });
});
