import { describe, it, expect } from "vitest";
import {
  compileInngest,
  InngestTarget,
  inngestCapabilities,
  InngestTargetError,
  type InngestTargetConfig,
  type InngestTargetGraph,
  type InngestFunction,
  type InngestStep,
  type CompilationResult,
  type GeneratedArtifact,
  type TargetDiagnostic,
} from "../index.js";

describe("public API — exports", () => {
  it("exports compileInngest function", () => {
    expect(typeof compileInngest).toBe("function");
  });

  it("exports InngestTarget class", () => {
    expect(typeof InngestTarget).toBe("function");
    expect(new InngestTarget().name).toBe("inngest");
  });

  it("exports inngestCapabilities manifest", () => {
    expect(inngestCapabilities).toBeDefined();
    expect(inngestCapabilities["trigger.manual"]).toBe("native");
    expect(inngestCapabilities["trigger.push"]).toBe("unsupported");
    expect(inngestCapabilities["agent.step"]).toBe("native");
  });

  it("exports InngestTargetError class", () => {
    const err = new InngestTargetError("msg", "INVALID_GRAPH");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("InngestTargetError");
    expect(err.code).toBe("INVALID_GRAPH");
    expect(err.cause).toBeUndefined();
  });

  it("exports type-only interfaces (compile-time check)", () => {
    const _config: InngestTargetConfig = { appId: "ci" };
    const _step: InngestStep = {
      stepId: "build",
      commands: [],
      dependsOn: [],
      hasScalarOutput: false,
      hasArtifactOutput: false,
    };
    const _fn: InngestFunction = {
      entryId: "on-manual",
      triggerKind: "manual",
      steps: [],
      sequence: [],
    };
    const _graph: InngestTargetGraph = { appId: "ci", functions: [] };
    const _result: CompilationResult = { artifacts: [], diagnostics: [] };
    const _artifact: GeneratedArtifact = { path: "ci.ts", content: "" };
    const _diag: TargetDiagnostic = {
      capability: "test",
      support: "native",
      severity: "info",
      message: "",
    };
    expect(_config).toBeDefined();
    expect(_step).toBeDefined();
    expect(_fn).toBeDefined();
    expect(_graph).toBeDefined();
    expect(_result).toBeDefined();
    expect(_artifact).toBeDefined();
    expect(_diag).toBeDefined();
  });
});
