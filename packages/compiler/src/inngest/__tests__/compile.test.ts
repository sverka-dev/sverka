import { describe, it, expect } from "vitest";
import { Project, Pipeline, synthesize } from "@sverka/workflow";
import { compileInngest, InngestTarget, InngestTargetError } from "../index.js";
import { makeGraph, makeSimpleGraph, makeGraphWithDeps, makeDiamondGraph, expectDiagnostic, conditionSteps, expectCondition, matrixStep, timeoutStep } from "../../__tests__/helpers/graphs.js";
import type { GraphOptions } from "../../__tests__/helpers/graphs.js";

/** Compile a graph and return the first artifact's content.
 * Preserves all supplied options; defaults to the simple graph's step + manual trigger. */
function compileContent(opts: GraphOptions = {}): string {
  return compileInngest(makeGraph({
    steps: [{ id: "build", command: "bun run build" }],
    ...opts,
  })).artifacts[0]!.content;
}

describe("compileInngest — basic", () => {
  it("produces one TypeScript artifact", () => {
    const result = compileInngest(makeSimpleGraph());
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]?.path).toBe("ci.ts");
  });

  it("imports Inngest from inngest core", () => {
    expect(compileContent()).toContain('import { Inngest } from "inngest"');
  });

  it("uses inngest.createFunction", () => {
    expect(compileContent()).toContain("inngest.createFunction(");
  });
});

describe("compileInngest — step.run", () => {
  it("single-step graph → one step.run call", () => {
    expect(compileContent()).toContain('step.run("build"');
  });

  it("step.run invokes sverka run --step", () => {
    expect(compileContent()).toContain("sverka run --step ci/build");
  });
});

describe("compileInngest — dependencies", () => {
  it("two-step graph with dependency → sequential step.run calls", () => {
    const content = compileInngest(makeGraphWithDeps()).artifacts[0]!.content;
    const lintIdx = content.indexOf('step.run("lint"');
    const buildIdx = content.indexOf('step.run("build"');
    expect(lintIdx).toBeGreaterThan(-1);
    expect(buildIdx).toBeGreaterThan(-1);
    expect(lintIdx).toBeLessThan(buildIdx);
  });

  it("diamond dependency → producers before consumer", () => {
    const content = compileInngest(makeDiamondGraph()).artifacts[0]!.content;
    const lintIdx = content.indexOf('step.run("lint"');
    const testIdx = content.indexOf('step.run("test"');
    const buildIdx = content.indexOf('step.run("build"');
    expect(lintIdx).toBeLessThan(buildIdx);
    expect(testIdx).toBeLessThan(buildIdx);
  });
});

describe("compileInngest — triggers", () => {
  it("manual trigger → event trigger", () => {
    expect(compileContent()).toContain('event: "sverka/ci/on-manual"');
  });

  it("schedule trigger → cron trigger", () => {
    expect(compileContent({ trigger: { kind: "schedule", cron: "0 * * * *" }, steps: [{ id: "build", command: "echo hi" }] }))
      .toContain('cron: "0 * * * *"');
  });

  it("push trigger → unsupported diagnostic", () => {
    const result = compileInngest(makeGraph({ trigger: { kind: "push" }, steps: [{ id: "build", command: "echo hi" }] }));
    expectDiagnostic(result.diagnostics, "trigger.push");
  });
});

describe("compileInngest — retry and timeout", () => {
  it("retry → retries in createFunction config", () => {
    expect(compileContent({ steps: [{ id: "build", command: "echo hi", retry: { max: 5 } }] })).toContain("retries: 5");
  });

  it("timeout → unsupported diagnostic and comment in generated code", () => {
    const result = compileInngest(makeGraph({ steps: [timeoutStep()] }));
    expectDiagnostic(result.diagnostics, "policy.timeout");
    expect(result.artifacts[0]!.content).toContain(
      "// timeout: 30s (Inngest step.run has no per-step timeout; use function-level timeouts.finish)",
    );
  });
});

describe("compileInngest — conditions and matrix", () => {
  it("condition status:failure → if (_failed) guard in generated code", () => {
    expectCondition(compileContent({ steps: conditionSteps("failure"), roots: ["notify"] }), "if (_failed)");
  });

  it("condition status:never → if (false) guard", () => {
    expectCondition(compileContent({ steps: conditionSteps("never") }), "if (false)");
  });

  it("condition status:success → if (!_failed) guard", () => {
    expectCondition(compileContent({ steps: conditionSteps("success"), roots: ["notify"] }), "if (!_failed)");
  });

  it("matrix → Promise.all in generated code", () => {
    const content = compileContent({ steps: [matrixStep()] });
    expect(content).toContain("Promise.all");
    expect(content).toContain('"18"');
    expect(content).toContain('"20"');
  });
});

describe("compileInngest — identifier validation", () => {
  it("entry ID starting with digit → prefixed with underscore", () => {
    expect(compileContent({ entryId: "1on-manual", steps: [{ id: "build", command: "echo hi" }] })).toContain("_1on_manual");
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
