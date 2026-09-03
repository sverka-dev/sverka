import { describe, it, expect } from "vitest";
import {
  compileDrone,
  DroneTarget,
  droneCapabilities,
  DroneTargetError,
  type DroneTargetConfig,
  type DroneTargetGraph,
  type DroneStep,
  type DroneTrigger,
  type CompilationResult,
  type GeneratedArtifact,
  type TargetDiagnostic,
} from "../index.js";

describe("public API — exports", () => {
  it("exports compileDrone function", () => {
    expect(typeof compileDrone).toBe("function");
  });

  it("exports DroneTarget class", () => {
    expect(typeof DroneTarget).toBe("function");
    expect(new DroneTarget().name).toBe("drone");
  });

  it("exports droneCapabilities manifest", () => {
    expect(droneCapabilities).toBeDefined();
    expect(droneCapabilities["trigger.push"]).toBe("native");
    expect(droneCapabilities["graph.conditions"]).toBe("unsupported");
    expect(droneCapabilities["agent.step"]).toBe("unsupported");
  });

  it("exports DroneTargetError class", () => {
    const err = new DroneTargetError("msg", "INVALID_GRAPH");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("DroneTargetError");
    expect(err.code).toBe("INVALID_GRAPH");
    expect(err.cause).toBeUndefined();
  });

  it("exports type-only interfaces (compile-time check)", () => {
    const _config: DroneTargetConfig = { type: "docker", image: "node:24" };
    const _graph: DroneTargetGraph = {
      name: "ci",
      type: "docker",
      steps: [],
      trigger: {},
    };
    const _step: DroneStep = {
      name: "build",
      image: "node:24",
      commands: [],
      dependsOn: [],
    };
    const _trigger: DroneTrigger = { event: ["push"] };
    const _result: CompilationResult = { artifacts: [], diagnostics: [] };
    const _artifact: GeneratedArtifact = { path: ".drone.yml", content: "" };
    const _diag: TargetDiagnostic = {
      capability: "test",
      support: "native",
      severity: "info",
      message: "",
    };
    // Touch to suppress unused-var lint
    expect(_config).toBeDefined();
    expect(_graph).toBeDefined();
    expect(_step).toBeDefined();
    expect(_trigger).toBeDefined();
    expect(_result).toBeDefined();
    expect(_artifact).toBeDefined();
    expect(_diag).toBeDefined();
  });
});
