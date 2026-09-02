import { describe, it, expect } from "vitest";
import { Project, Pipeline } from "@sverka/workflow";
import { synthesize } from "@sverka/workflow";
import { compileInngest, InngestTarget, InngestTargetError } from "../index.js";
import {
  makeGraph,
  makeSimpleGraph,
  makeGraphWithDeps,
  makeDiamondGraph,
  expectDiagnostic,
} from "../../__tests__/helpers/graphs.js";

describe("compileInngest — basic", () => {
  it("produces one TypeScript artifact", () => {
    const result = compileInngest(makeSimpleGraph());
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]?.path).toBe("ci.ts");
  });

  it("imports Inngest from inngest core", () => {
    const result = compileInngest(makeSimpleGraph());
    const content = result.artifacts[0]!.content;
    expect(content).toContain('import { Inngest } from "inngest"');
  });

  it("uses inngest.createFunction", () => {
    const result = compileInngest(makeSimpleGraph());
    const content = result.artifacts[0]!.content;
    expect(content).toContain("inngest.createFunction(");
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
    const result = compileInngest(
      makeGraph({ trigger: { kind: "schedule", cron: "0 * * * *" }, steps: [{ id: "build", command: "echo hi" }] }),
    );
    const content = result.artifacts[0]!.content;
    expect(content).toContain('cron: "0 * * * *"');
  });

  it("push trigger → unsupported diagnostic", () => {
    const result = compileInngest(makeGraph({ trigger: { kind: "push" }, steps: [{ id: "build", command: "echo hi" }] }));
    expectDiagnostic(result.diagnostics, "trigger.push");
  });
});

describe("compileInngest — retry and timeout", () => {
  it("retry → retries in createFunction config", () => {
    const result = compileInngest(makeGraph({ steps: [{ id: "build", command: "echo hi", retry: { max: 5 } }] }));
    const content = result.artifacts[0]!.content;
    expect(content).toContain("retries: 5");
  });

  it("timeout → timeout option in step.run", () => {
    const result = compileInngest(makeGraph({ steps: [{ id: "build", command: "echo hi", timeout: 30000 }] }));
    const content = result.artifacts[0]!.content;
    expect(content).toContain("timeout: 30");
  });
});

describe("compileInngest — conditions and matrix", () => {
  it("condition status:failure → if (_failed) guard in generated code", () => {
    const result = compileInngest(
      makeGraph({
        steps: [
          { id: "build", command: "echo hi" },
          {
            id: "notify",
            command: "echo failed",
            condition: { kind: "status", status: "failure" },
            dependsOn: ["build"],
          },
        ],
        roots: ["notify"],
      }),
    );
    const content = result.artifacts[0]!.content;
    expect(content).toContain("if (_failed)");
    expect(content).not.toContain("if (true)");
  });

  it("condition status:never → if (false) guard", () => {
    const result = compileInngest(
      makeGraph({ steps: [{ id: "build", command: "echo hi", condition: { kind: "status", status: "never" } }] }),
    );
    const content = result.artifacts[0]!.content;
    expect(content).toContain("if (false)");
    expect(content).not.toContain("if (true)");
  });

  it("condition status:success → if (!_failed) guard", () => {
    const result = compileInngest(
      makeGraph({
        steps: [
          { id: "build", command: "echo hi" },
          {
            id: "test",
            command: "echo test",
            condition: { kind: "status", status: "success" },
            dependsOn: ["build"],
          },
        ],
        roots: ["test"],
      }),
    );
    const content = result.artifacts[0]!.content;
    expect(content).toContain("if (!_failed)");
    expect(content).not.toContain("if (true)");
  });

  it("matrix → Promise.all in generated code", () => {
    const result = compileInngest(
      makeGraph({ steps: [{ id: "build", command: "echo hi", matrix: { dimensions: { node: ["18", "20"] } } }] }),
    );
    const content = result.artifacts[0]!.content;
    expect(content).toContain("Promise.all");
    expect(content).toContain('"18"');
    expect(content).toContain('"20"');
  });
});

describe("compileInngest — identifier validation", () => {
  it("entry ID starting with digit → prefixed with underscore", () => {
    const result = compileInngest(makeGraph({ entryId: "1on-manual", steps: [{ id: "build", command: "echo hi" }] }));
    const content = result.artifacts[0]!.content;
    expect(content).toContain("_1on_manual");
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
