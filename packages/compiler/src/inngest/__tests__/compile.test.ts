import { describe, it, expect } from "vitest";
import { Project, Pipeline, ShellStep, Entry, type DefinitionGraph } from "@sverka/workflow";
import { synthesize } from "@sverka/workflow";
import { compileInngest, InngestTarget, InngestTargetError } from "../index.js";

function makeSimpleGraph(): DefinitionGraph {
  const proj = new Project("test");
  const p = new Pipeline(proj, "ci");
  new ShellStep(p, "build", { command: "bun run build" });
  new Entry(p, "on-manual", { trigger: { kind: "manual" }, roots: ["build"] });
  return synthesize(proj);
}

function makeGraphWithDeps(): DefinitionGraph {
  const proj = new Project("test");
  const p = new Pipeline(proj, "ci");
  new ShellStep(p, "lint", { command: "bun run lint" });
  new ShellStep(p, "build", { command: "bun run build", dependsOn: ["lint"] });
  new Entry(p, "on-manual", { trigger: { kind: "manual" }, roots: ["build"] });
  return synthesize(proj);
}

function makeDiamondGraph(): DefinitionGraph {
  const proj = new Project("test");
  const p = new Pipeline(proj, "ci");
  new ShellStep(p, "lint", { command: "bun run lint" });
  new ShellStep(p, "test", { command: "bun run test" });
  new ShellStep(p, "build", { command: "bun run build", dependsOn: ["lint", "test"] });
  new Entry(p, "on-manual", { trigger: { kind: "manual" }, roots: ["build"] });
  return synthesize(proj);
}

describe("compileInngest — basic", () => {
  it("produces one TypeScript artifact", () => {
    const result = compileInngest(makeSimpleGraph());
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]?.path).toBe("ci.ts");
  });

  it("imports @inngest/agent-kit", () => {
    const result = compileInngest(makeSimpleGraph());
    const content = result.artifacts[0]!.content;
    expect(content).toContain('import { createFunction } from "@inngest/agent-kit"');
  });

  it("uses createFunction", () => {
    const result = compileInngest(makeSimpleGraph());
    const content = result.artifacts[0]!.content;
    expect(content).toContain("createFunction(");
  });
});

describe("compileInngest — step.run", () => {
  it("single-step graph → one step.run call", () => {
    const result = compileInngest(makeSimpleGraph());
    const content = result.artifacts[0]!.content;
    expect(content).toContain('step.run("build"');
  });

  it("step.run invokes sverka run --step", () => {
    const result = compileInngest(makeSimpleGraph());
    const content = result.artifacts[0]!.content;
    expect(content).toContain("sverka run --step ci/build");
  });
});

describe("compileInngest — dependencies", () => {
  it("two-step graph with dependency → sequential step.run calls", () => {
    const result = compileInngest(makeGraphWithDeps());
    const content = result.artifacts[0]!.content;
    const lintIdx = content.indexOf('step.run("lint"');
    const buildIdx = content.indexOf('step.run("build"');
    expect(lintIdx).toBeGreaterThan(-1);
    expect(buildIdx).toBeGreaterThan(-1);
    expect(lintIdx).toBeLessThan(buildIdx);
  });

  it("diamond dependency → producers before consumer", () => {
    const result = compileInngest(makeDiamondGraph());
    const content = result.artifacts[0]!.content;
    const lintIdx = content.indexOf('step.run("lint"');
    const testIdx = content.indexOf('step.run("test"');
    const buildIdx = content.indexOf('step.run("build"');
    expect(lintIdx).toBeLessThan(buildIdx);
    expect(testIdx).toBeLessThan(buildIdx);
  });
});

describe("compileInngest — triggers", () => {
  it("manual trigger → event trigger", () => {
    const result = compileInngest(makeSimpleGraph());
    const content = result.artifacts[0]!.content;
    expect(content).toContain('event: "sverka/ci/on-manual"');
  });

  it("schedule trigger → cron trigger", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi" });
    new Entry(p, "on-schedule", { trigger: { kind: "schedule", cron: "0 * * * *" }, roots: ["build"] });
    const result = compileInngest(synthesize(proj));
    const content = result.artifacts[0]!.content;
    expect(content).toContain('cron: "0 * * * *"');
  });

  it("push trigger → unsupported diagnostic", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi" });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileInngest(synthesize(proj));
    expect(result.diagnostics.some((d) => d.capability === "trigger.push")).toBe(true);
  });
});

describe("compileInngest — retry and timeout", () => {
  it("retry → retries in createFunction config", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi", retry: { max: 5 } });
    new Entry(p, "on-manual", { trigger: { kind: "manual" }, roots: ["build"] });
    const result = compileInngest(synthesize(proj));
    const content = result.artifacts[0]!.content;
    expect(content).toContain("retries: 5");
  });

  it("timeout → timeout option in step.run", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi", timeout: 30000 });
    new Entry(p, "on-manual", { trigger: { kind: "manual" }, roots: ["build"] });
    const result = compileInngest(synthesize(proj));
    const content = result.artifacts[0]!.content;
    expect(content).toContain("timeout: 30");
  });
});

describe("compileInngest — conditions and matrix", () => {
  it("condition → if/else in generated code", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "echo hi",
      condition: { kind: "status", status: "failure" },
    });
    new Entry(p, "on-manual", { trigger: { kind: "manual" }, roots: ["build"] });
    const result = compileInngest(synthesize(proj));
    const content = result.artifacts[0]!.content;
    expect(content).toContain("if (true)");
  });

  it("matrix → Promise.all in generated code", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "echo hi",
      matrix: { dimensions: { node: ["18", "20"] } },
    });
    new Entry(p, "on-manual", { trigger: { kind: "manual" }, roots: ["build"] });
    const result = compileInngest(synthesize(proj));
    const content = result.artifacts[0]!.content;
    expect(content).toContain("Promise.all");
    expect(content).toContain('"18"');
    expect(content).toContain('"20"');
  });
});

describe("compileInngest — errors", () => {
  it("throws INVALID_GRAPH for empty graph", () => {
    const proj = new Project("test");
    new Pipeline(proj, "ci");
    expect(() => compileInngest(synthesize(proj))).toThrow(InngestTargetError);
    expect(() => compileInngest(synthesize(proj))).toThrow(/no root pipelines/);
  });
});

describe("compileInngest — determinism", () => {
  it("same graph → identical output", () => {
    const r1 = compileInngest(makeSimpleGraph());
    const r2 = compileInngest(makeSimpleGraph());
    expect(r1.artifacts[0]?.content).toBe(r2.artifacts[0]?.content);
  });
});

describe("compileInngest — InngestTarget class", () => {
  it("exposes name and capabilities", () => {
    const target = new InngestTarget();
    expect(target.name).toBe("inngest");
    expect(target.capabilities["trigger.manual"]).toBe("native");
    expect(target.capabilities["trigger.push"]).toBe("unsupported");
    expect(target.capabilities["agent.step"]).toBe("native");
  });

  it("honors appId config", () => {
    const result = compileInngest(makeSimpleGraph(), { appId: "my-app" });
    expect(result.artifacts[0]?.path).toBe("my-app.ts");
    expect(result.artifacts[0]?.content).toContain("my-app");
  });
});
