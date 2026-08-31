import { describe, it, expect } from "vitest";
import {
  compileTemporal,
  TemporalTarget,
  temporalCapabilities,
  TemporalTargetError,
  type TemporalTargetConfig,
  type TemporalTargetGraph,
  type TemporalWorkflow,
  type TemporalActivity,
  type CompilationResult,
  type GeneratedArtifact,
  type TargetDiagnostic,
} from "../index.js";

describe("public API — exports", () => {
  it("exports compileTemporal function", () => {
    expect(typeof compileTemporal).toBe("function");
  });

  it("exports TemporalTarget class", () => {
    expect(typeof TemporalTarget).toBe("function");
    expect(new TemporalTarget().name).toBe("temporal");
  });

  it("exports temporalCapabilities manifest", () => {
    expect(temporalCapabilities).toBeDefined();
    expect(temporalCapabilities["trigger.manual"]).toBe("native");
    expect(temporalCapabilities["trigger.push"]).toBe("unsupported");
    expect(temporalCapabilities["agent.step"]).toBe("emulated");
  });

  it("exports TemporalTargetError class", () => {
    const err = new TemporalTargetError("msg", "INVALID_GRAPH");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("TemporalTargetError");
    expect(err.code).toBe("INVALID_GRAPH");
    expect(err.cause).toBeUndefined();
  });

  it("exports type-only interfaces (compile-time check)", () => {
    const _config: TemporalTargetConfig = { namespace: "default", taskQueue: "sverka" };
    const _activity: TemporalActivity = { stepId: "build" };
    const _wf: TemporalWorkflow = {
      entryId: "on-manual",
      triggerKind: "manual",
      activities: [],
      sequence: [],
    };
    const _graph: TemporalTargetGraph = {
      name: "ci",
      namespace: "default",
      taskQueue: "sverka",
      workflows: [],
    };
    const _result: CompilationResult = { artifacts: [], diagnostics: [] };
    const _artifact: GeneratedArtifact = { path: "ci.workflow.ts", content: "" };
    const _diag: TargetDiagnostic = {
      capability: "test",
      support: "native",
      severity: "info",
      message: "",
    };
    expect(_config).toBeDefined();
    expect(_activity).toBeDefined();
    expect(_wf).toBeDefined();
    expect(_graph).toBeDefined();
    expect(_result).toBeDefined();
    expect(_artifact).toBeDefined();
    expect(_diag).toBeDefined();
  });
});
