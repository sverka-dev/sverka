import { describe, it, expect } from "vitest";
import { Project, Pipeline, synthesize } from "@sverka/workflow";
import { compileDagger, DaggerTarget, DaggerTargetError } from "../index.js";
import { makeGraph, makeSimpleGraph, makeGraphWithDeps, makeDiamondGraph, expectDiagnostic, conditionSteps, expectCondition, matrixStep, timeoutStep } from "../../__tests__/helpers/graphs.js";
import type { GraphOptions } from "../../__tests__/helpers/graphs.js";

/** Compile the default simple graph and return the first artifact's content. */
function compileContent(opts: GraphOptions = {}): string {
  return compileDagger(opts.steps ? makeGraph(opts) : makeSimpleGraph()).artifacts[0]!.content;
}

describe("compileDagger — basic", () => {
  it("produces one TypeScript artifact", () => {
    const result = compileDagger(makeSimpleGraph());
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]?.path).toBe("ci.ts");
  });

  it("imports @dagger.io/dagger", () => {
    expect(compileContent()).toContain('import { dag, object, func } from "@dagger.io/dagger"');
  });

  it("uses @object and @func decorators", () => {
    const content = compileContent();
    expect(content).toContain("@object()");
    expect(content).toContain("@func()");
  });

  it("exports SverkaPipeline class", () => {
    expect(compileContent()).toContain("export class SverkaPipeline");
  });
});

describe("compileDagger — shell operations", () => {
  it("maps shell command to withExec via sh -c", () => {
    expect(compileContent()).toContain('ctx.withExec(["sh", "-c", "bun run build"])');
  });
});

describe("compileDagger — dependencies", () => {
  it("chains steps in dependency order", () => {
    const content = compileDagger(makeGraphWithDeps()).artifacts[0]!.content;
    const lintIdx = content.indexOf('bun run lint');
    const buildIdx = content.indexOf('bun run build');
    expect(lintIdx).toBeGreaterThan(-1);
    expect(buildIdx).toBeGreaterThan(-1);
    expect(lintIdx).toBeLessThan(buildIdx);
  });

  it("diamond dependency → producers before consumer", () => {
    const content = compileDagger(makeDiamondGraph()).artifacts[0]!.content;
    const lintIdx = content.indexOf('bun run lint');
    const testIdx = content.indexOf('bun run test');
    const buildIdx = content.indexOf('bun run build');
    expect(lintIdx).toBeLessThan(buildIdx);
    expect(testIdx).toBeLessThan(buildIdx);
  });
});

describe("compileDagger — runtime", () => {
  it("container runtime → native (no warning)", () => {
    expect(compileContent({ steps: [{ id: "build", command: "echo hi", runtime: { mode: "container", image: "node:24" } }] }))
      .not.toContain("Host runtime is unsupported");
  });

  it("host runtime → unsupported diagnostic", () => {
    const result = compileDagger(makeGraph({ steps: [{ id: "build", command: "echo hi", runtime: { mode: "host" } }] }));
    expectDiagnostic(result.diagnostics, "runtime.host");
  });
});

describe("compileDagger — retry and timeout", () => {
  it("retry → wrapper loop in generated code", () => {
    const content = compileContent({ steps: [{ id: "build", command: "echo hi", retry: { max: 3 } }] });
    expect(content).toContain("attempt < 3");
    expect(content).toContain("Retry wrapper");
  });

  it("timeout → documented in generated code (Dagger has no withTimeout)", () => {
    expect(compileContent({ steps: [timeoutStep()] })).toContain("timeout: 30s");
  });
});

describe("compileDagger — conditions and matrix", () => {
  it("condition status:failure → if (_failed) guard in code", () => {
    expectCondition(compileContent({ steps: conditionSteps("failure"), roots: ["notify"] }), "if (_failed)");
  });

  it("condition status:never → if (false) guard", () => {
    expectCondition(compileContent({ steps: conditionSteps("never") }), "if (false)");
  });

  it("condition status:always → no if guard", () => {
    const content = compileContent({ steps: conditionSteps("always") });
    expect(content).not.toContain("if (true)");
    expect(content).not.toContain("if (false)");
  });

  it("condition status:success → if (!_failed) guard", () => {
    expectCondition(compileContent({ steps: conditionSteps("success"), roots: ["notify"] }), "if (!_failed)");
  });

  it("matrix → loop in generated code", () => {
    const content = compileContent({ steps: [matrixStep()] });
    expect(content).toContain("Matrix: emulated");
    expect(content).toContain('"18"');
    expect(content).toContain('"20"');
  });
});

describe("compileDagger — command quoting", () => {
  it("preserves quoted arguments via sh -c", () => {
    const content = compileContent({ steps: [{ id: "build", command: 'echo "hello world"' }] });
    expect(content).toContain('"sh"');
    expect(content).toContain('"-c"');
    expect(content).toContain('echo \\"hello world\\"');
    expect(content).not.toContain('"echo"');
  });
});

describe("compileDagger — retry off-by-one", () => {
  it("retry max:3 → loop runs exactly 3 attempts (0..2)", () => {
    const content = compileContent({ steps: [{ id: "build", command: "echo hi", retry: { max: 3 } }] });
    expect(content).toContain("attempt < 3");
    expect(content).not.toContain("attempt <= 3");
  });
});

describe("compileDagger — identifier validation", () => {
  it("entry ID starting with digit → prefixed with underscore", () => {
    const content = compileContent({ entryId: "1on-manual", steps: [{ id: "build", command: "echo hi" }] });
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
