import { describe, it, expect } from "vitest";
import { Project, Pipeline, ShellStep, Entry, type DefinitionGraph } from "@sverka/workflow";
import { synthesize } from "@sverka/workflow";
import { compileDagger, DaggerTarget, DaggerTargetError } from "../index.js";

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

describe("compileDagger — basic", () => {
  it("produces one TypeScript artifact", () => {
    const result = compileDagger(makeSimpleGraph());
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]?.path).toBe("ci.ts");
  });

  it("imports @dagger.io/dagger", () => {
    const result = compileDagger(makeSimpleGraph());
    const content = result.artifacts[0]!.content;
    expect(content).toContain('import { dag, object, func } from "@dagger.io/dagger"');
  });

  it("uses @object and @func decorators", () => {
    const result = compileDagger(makeSimpleGraph());
    const content = result.artifacts[0]!.content;
    expect(content).toContain("@object()");
    expect(content).toContain("@func()");
  });

  it("exports SverkaPipeline class", () => {
    const result = compileDagger(makeSimpleGraph());
    const content = result.artifacts[0]!.content;
    expect(content).toContain("export class SverkaPipeline");
  });
});

describe("compileDagger — shell operations", () => {
  it("maps shell command to withExec via sh -c", () => {
    const result = compileDagger(makeSimpleGraph());
    const content = result.artifacts[0]!.content;
    expect(content).toContain('ctx.withExec(["sh", "-c", "bun run build"])');
  });
});

describe("compileDagger — dependencies", () => {
  it("chains steps in dependency order", () => {
    const result = compileDagger(makeGraphWithDeps());
    const content = result.artifacts[0]!.content;
    const lintIdx = content.indexOf('bun run lint');
    const buildIdx = content.indexOf('bun run build');
    expect(lintIdx).toBeGreaterThan(-1);
    expect(buildIdx).toBeGreaterThan(-1);
    expect(lintIdx).toBeLessThan(buildIdx);
  });

  it("diamond dependency → producers before consumer", () => {
    const result = compileDagger(makeDiamondGraph());
    const content = result.artifacts[0]!.content;
    const lintIdx = content.indexOf('bun run lint');
    const testIdx = content.indexOf('bun run test');
    const buildIdx = content.indexOf('bun run build');
    expect(lintIdx).toBeLessThan(buildIdx);
    expect(testIdx).toBeLessThan(buildIdx);
  });
});

describe("compileDagger — runtime", () => {
  it("container runtime → native (no warning)", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "echo hi",
      runtime: { mode: "container", image: "node:24" },
    });
    new Entry(p, "on-manual", { trigger: { kind: "manual" }, roots: ["build"] });
    const result = compileDagger(synthesize(proj));
    const content = result.artifacts[0]!.content;
    expect(content).not.toContain("Host runtime is unsupported");
  });

  it("host runtime → unsupported diagnostic", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi", runtime: { mode: "host" } });
    new Entry(p, "on-manual", { trigger: { kind: "manual" }, roots: ["build"] });
    const result = compileDagger(synthesize(proj));
    expect(result.diagnostics.some((d) => d.capability === "runtime.host")).toBe(true);
  });
});

describe("compileDagger — retry and timeout", () => {
  it("retry → wrapper loop in generated code", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi", retry: { max: 3 } });
    new Entry(p, "on-manual", { trigger: { kind: "manual" }, roots: ["build"] });
    const result = compileDagger(synthesize(proj));
    const content = result.artifacts[0]!.content;
    expect(content).toContain("attempt < 3");
    expect(content).toContain("Retry wrapper");
  });

  it("timeout → documented in generated code (Dagger has no withTimeout)", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi", timeout: 30000 });
    new Entry(p, "on-manual", { trigger: { kind: "manual" }, roots: ["build"] });
    const result = compileDagger(synthesize(proj));
    const content = result.artifacts[0]!.content;
    expect(content).toContain("timeout: 30s");
  });
});

describe("compileDagger — conditions and matrix", () => {
  it("condition status:failure → if (_failed) guard in code", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi" });
    new ShellStep(p, "notify", {
      command: "echo failed",
      condition: { kind: "status", status: "failure" },
      dependsOn: ["build"],
    });
    new Entry(p, "on-manual", { trigger: { kind: "manual" }, roots: ["notify"] });
    const result = compileDagger(synthesize(proj));
    const content = result.artifacts[0]!.content;
    expect(content).toContain("if (_failed)");
    expect(content).not.toContain("if (true)");
  });

  it("condition status:never → if (false) guard", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "echo hi",
      condition: { kind: "status", status: "never" },
    });
    new Entry(p, "on-manual", { trigger: { kind: "manual" }, roots: ["build"] });
    const result = compileDagger(synthesize(proj));
    const content = result.artifacts[0]!.content;
    expect(content).toContain("if (false)");
    expect(content).not.toContain("if (true)");
  });

  it("condition status:always → no if guard", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "echo hi",
      condition: { kind: "status", status: "always" },
    });
    new Entry(p, "on-manual", { trigger: { kind: "manual" }, roots: ["build"] });
    const result = compileDagger(synthesize(proj));
    const content = result.artifacts[0]!.content;
    expect(content).not.toContain("if (true)");
    expect(content).not.toContain("if (false)");
  });

  it("condition status:success → if (!_failed) guard", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi" });
    new ShellStep(p, "test", {
      command: "echo test",
      condition: { kind: "status", status: "success" },
      dependsOn: ["build"],
    });
    new Entry(p, "on-manual", { trigger: { kind: "manual" }, roots: ["test"] });
    const result = compileDagger(synthesize(proj));
    const content = result.artifacts[0]!.content;
    expect(content).toContain("if (!_failed)");
    expect(content).not.toContain("if (true)");
  });

  it("matrix → loop in generated code", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "echo hi",
      matrix: { dimensions: { node: ["18", "20"] } },
    });
    new Entry(p, "on-manual", { trigger: { kind: "manual" }, roots: ["build"] });
    const result = compileDagger(synthesize(proj));
    const content = result.artifacts[0]!.content;
    expect(content).toContain("Matrix: emulated");
    expect(content).toContain('"18"');
    expect(content).toContain('"20"');
  });
});

describe("compileDagger — command quoting", () => {
  it("preserves quoted arguments via sh -c", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: 'echo "hello world"' });
    new Entry(p, "on-manual", { trigger: { kind: "manual" }, roots: ["build"] });
    const result = compileDagger(synthesize(proj));
    const content = result.artifacts[0]!.content;
    expect(content).toContain('"sh"');
    expect(content).toContain('"-c"');
    expect(content).toContain('echo \\"hello world\\"');
    // Should NOT split on whitespace
    expect(content).not.toContain('"echo"');
  });
});

describe("compileDagger — retry off-by-one", () => {
  it("retry max:3 → loop runs exactly 3 attempts (0..2)", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi", retry: { max: 3 } });
    new Entry(p, "on-manual", { trigger: { kind: "manual" }, roots: ["build"] });
    const result = compileDagger(synthesize(proj));
    const content = result.artifacts[0]!.content;
    expect(content).toContain("attempt < 3");
    expect(content).not.toContain("attempt <= 3");
  });
});

describe("compileDagger — identifier validation", () => {
  it("entry ID starting with digit → prefixed with underscore", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi" });
    new Entry(p, "1on-manual", { trigger: { kind: "manual" }, roots: ["build"] });
    const result = compileDagger(synthesize(proj));
    const content = result.artifacts[0]!.content;
    expect(content).toContain("_1on_manual");
    expect(content).not.toContain(" 1on_manual");
  });
});

describe("compileDagger — errors", () => {
  it("throws INVALID_GRAPH for empty graph", () => {
    const proj = new Project("test");
    new Pipeline(proj, "ci");
    expect(() => compileDagger(synthesize(proj))).toThrow(DaggerTargetError);
    expect(() => compileDagger(synthesize(proj))).toThrow(/no root pipelines/);
  });
});

describe("compileDagger — determinism", () => {
  it("same graph → identical output", () => {
    const r1 = compileDagger(makeSimpleGraph());
    const r2 = compileDagger(makeSimpleGraph());
    expect(r1.artifacts[0]?.content).toBe(r2.artifacts[0]?.content);
  });
});

describe("compileDagger — DaggerTarget class", () => {
  it("exposes name and capabilities", () => {
    const target = new DaggerTarget();
    expect(target.name).toBe("dagger");
    expect(target.capabilities["operation.shell"]).toBe("native");
    expect(target.capabilities["runtime.host"]).toBe("unsupported");
  });

  it("honors moduleName config", () => {
    const result = compileDagger(makeSimpleGraph(), { moduleName: "my-module" });
    expect(result.artifacts[0]?.path).toBe("my-module.ts");
  });
});
