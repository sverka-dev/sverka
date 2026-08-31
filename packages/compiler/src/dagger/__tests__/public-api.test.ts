import { describe, it, expect } from "vitest";
import {
  compileDagger,
  DaggerTarget,
  daggerCapabilities,
  DaggerTargetError,
  type DaggerTargetConfig,
  type DaggerTargetGraph,
  type DaggerStep,
  type CompilationResult,
  type GeneratedArtifact,
  type TargetDiagnostic,
} from "../index.js";

describe("public API — exports", () => {
  it("exports compileDagger function", () => {
    expect(typeof compileDagger).toBe("function");
  });

  it("exports DaggerTarget class", () => {
    expect(typeof DaggerTarget).toBe("function");
    expect(new DaggerTarget().name).toBe("dagger");
  });

  it("exports daggerCapabilities manifest", () => {
    expect(daggerCapabilities).toBeDefined();
    expect(daggerCapabilities["operation.shell"]).toBe("native");
    expect(daggerCapabilities["runtime.host"]).toBe("unsupported");
    expect(daggerCapabilities["agent.step"]).toBe("emulated");
  });

  it("exports DaggerTargetError class", () => {
    const err = new DaggerTargetError("msg", "INVALID_GRAPH");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("DaggerTargetError");
    expect(err.code).toBe("INVALID_GRAPH");
    expect(err.cause).toBeUndefined();
  });

  it("exports type-only interfaces (compile-time check)", () => {
    const _config: DaggerTargetConfig = { moduleName: "ci" };
    const _step: DaggerStep = {
      stepId: "ci/build",
      name: "build",
      commands: ["bun run build"],
      dependsOn: [],
      runtime: { mode: "container" },
    };
    const _graph: DaggerTargetGraph = {
      moduleName: "ci",
      entryId: "on-manual",
      steps: [_step],
      sequence: ["ci/build"],
    };
    const _result: CompilationResult = { artifacts: [], diagnostics: [] };
    const _artifact: GeneratedArtifact = { path: "ci.ts", content: "" };
    const _diag: TargetDiagnostic = {
      capability: "test",
      support: "native",
      severity: "info",
      message: "",
    };
    expect(_config).toBeDefined();
    expect(_graph).toBeDefined();
    expect(_step).toBeDefined();
    expect(_result).toBeDefined();
    expect(_artifact).toBeDefined();
    expect(_diag).toBeDefined();
  });
});
