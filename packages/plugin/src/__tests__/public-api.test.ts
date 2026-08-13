import { describe, it, expect } from "vitest";
import {
  defineSverkaPlugin,
  createPluginRegistry,
  analyzeCapabilities,
  detectCapabilities,
  PluginError,
  type SverkaPlugin,
  type PluginOptions,
  type PluginMeta,
  type PluginRegistry,
  type CapabilityManifest,
  type CapabilitySupport,
  type CapabilityDetail,
  type CapabilityDiagnostic,
  type ModelContribution,
  type GraphTransform,
  type GraphValidator,
  type Target,
  type CompilationResult,
  type Importer,
  type Engine,
  type ConnectorFactory,
  type NativeExtension,
  type PluginErrorCode,
} from "../index.js";

describe("public API — exports", () => {
  it("exports all functions", () => {
    expect(typeof defineSverkaPlugin).toBe("function");
    expect(typeof createPluginRegistry).toBe("function");
    expect(typeof analyzeCapabilities).toBe("function");
    expect(typeof detectCapabilities).toBe("function");
  });

  it("exports PluginError class", () => {
    const err = new PluginError("msg", "INVALID_PLUGIN");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PluginError");
    expect(err.code).toBe("INVALID_PLUGIN");
    expect(err.cause).toBeUndefined();
  });

  it("all types are importable (compile-time check)", () => {
    const _plugin: SverkaPlugin = { name: "x", apiVersion: "v1" };
    const _opts: PluginOptions = {};
    const _meta: PluginMeta = { version: "1" };
    const _reg: PluginRegistry = createPluginRegistry();
    const _manifest: CapabilityManifest = { "trigger.push": "native" };
    const _support: CapabilitySupport = "native";
    const _detail: CapabilityDetail = { support: "native" };
    const _diag: CapabilityDiagnostic = {
      capability: "x",
      support: "native",
      severity: "info",
      message: "ok",
    };
    const _model: ModelContribution = { kind: "x" };
    const _code: PluginErrorCode = "INVALID_PLUGIN";
    expect(_plugin.name).toBe("x");
    expect(_opts).toBeDefined();
    expect(_meta.version).toBe("1");
    expect(_reg.plugins).toHaveLength(0);
    expect(_manifest["trigger.push"]).toBe("native");
    expect(_support).toBe("native");
    expect(_detail.support).toBe("native");
    expect(_diag.capability).toBe("x");
    expect(_model.kind).toBe("x");
    expect(_code).toBe("INVALID_PLUGIN");
    // Touch unused types
    void (null as unknown as GraphTransform);
    void (null as unknown as GraphValidator);
    void (null as unknown as Target);
    void (null as unknown as CompilationResult);
    void (null as unknown as Importer);
    void (null as unknown as Engine);
    void (null as unknown as ConnectorFactory);
    void (null as unknown as NativeExtension);
  });
});
