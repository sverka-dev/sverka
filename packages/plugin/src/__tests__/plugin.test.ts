import { describe, it, expect } from "vitest";
import {
  defineSverkaPlugin,
  createPluginRegistry,
  analyzeCapabilities,
  detectCapabilities,
  PluginError,
  type SverkaPlugin,
  type CapabilityManifest,
} from "../index.js";
import type { DefinitionGraph } from "@sverka/core";

function makeGraph(opts: {
  triggerKind?: "push" | "changeRequest" | "manual";
  runtimeMode?: "host" | "container";
  hasDeps?: boolean;
  hasShell?: boolean;
  hasScalarOutput?: boolean;
  hasArtifactOutput?: boolean;
} = {}): DefinitionGraph {
  const triggerKind = opts.triggerKind ?? "push";
  const runtimeMode = opts.runtimeMode ?? "host";
  const outputs: { type: "string" | "artifact"; path?: string }[] = [];
  if (opts.hasScalarOutput) outputs.push({ type: "string" });
  if (opts.hasArtifactOutput) outputs.push({ type: "artifact", path: "./dist" });

  return {
    project: {
      id: "test",
      pipelines: [{
        id: "ci",
        inputs: {},
        entries: [{
          id: "on-push",
          trigger: { kind: triggerKind },
          roots: ["build"],
        }],
        steps: [{
          id: "build",
          runtime: { mode: runtimeMode },
          operations: opts.hasShell === false ? [] : [{ kind: "shell", command: "echo hi" }],
          inputs: [],
          outputs,
          dependencies: opts.hasDeps ? [{ kind: "control", producer: "lint" }] : [],
        }],
        outputs: [],
      }],
    },
  };
}

describe("defineSverkaPlugin", () => {
  it("creates a plugin with name and apiVersion", () => {
    const plugin = defineSverkaPlugin(() => ({
      name: "github",
      apiVersion: "sverka.dev/v1",
    }));
    expect(plugin.name).toBe("github");
    expect(plugin.apiVersion).toBe("sverka.dev/v1");
  });

  it("creates a plugin with capabilities", () => {
    const plugin = defineSverkaPlugin(() => ({
      name: "github",
      apiVersion: "sverka.dev/v1",
      capabilities: { "trigger.push": "native" },
    }));
    expect(plugin.capabilities).toBeDefined();
    expect((plugin.capabilities as CapabilityManifest)["trigger.push"]).toBe("native");
  });

  it("throws INVALID_PLUGIN for missing name", () => {
    expect(() =>
      defineSverkaPlugin(() => ({ name: "", apiVersion: "v1" })),
    ).toThrow(PluginError);
  });

  it("throws INVALID_PLUGIN for missing apiVersion", () => {
    expect(() =>
      defineSverkaPlugin(() => ({ name: "test", apiVersion: "" })),
    ).toThrow(PluginError);
  });
});

describe("detectCapabilities", () => {
  it("detects trigger.push from entries", () => {
    const caps = detectCapabilities(makeGraph({ triggerKind: "push" }));
    expect(caps.has("trigger.push")).toBe(true);
  });

  it("detects trigger.manual from entries", () => {
    const caps = detectCapabilities(makeGraph({ triggerKind: "manual" }));
    expect(caps.has("trigger.manual")).toBe(true);
  });

  it("detects runtime.host from step runtime", () => {
    const caps = detectCapabilities(makeGraph({ runtimeMode: "host" }));
    expect(caps.has("runtime.host")).toBe(true);
  });

  it("detects runtime.container from step runtime", () => {
    const caps = detectCapabilities(makeGraph({ runtimeMode: "container" }));
    expect(caps.has("runtime.container")).toBe(true);
  });

  it("detects operation.shell from shell operations", () => {
    const caps = detectCapabilities(makeGraph({ hasShell: true }));
    expect(caps.has("operation.shell")).toBe(true);
  });

  it("detects graph.dependencies when steps have deps", () => {
    const caps = detectCapabilities(makeGraph({ hasDeps: true }));
    expect(caps.has("graph.dependencies")).toBe(true);
  });

  it("does not detect graph.dependencies when no deps", () => {
    const caps = detectCapabilities(makeGraph({ hasDeps: false }));
    expect(caps.has("graph.dependencies")).toBe(false);
  });

  it("detects output.scalar", () => {
    const caps = detectCapabilities(makeGraph({ hasScalarOutput: true }));
    expect(caps.has("output.scalar")).toBe(true);
  });

  it("detects output.artifact", () => {
    const caps = detectCapabilities(makeGraph({ hasArtifactOutput: true }));
    expect(caps.has("output.artifact")).toBe(true);
  });
});

describe("analyzeCapabilities", () => {
  it("no diagnostics when all capabilities are native", () => {
    const graph = makeGraph();
    const manifests: CapabilityManifest[] = [{
      "trigger.push": "native",
      "runtime.host": "native",
      "operation.shell": "native",
    }];
    const diags = analyzeCapabilities(graph, manifests);
    expect(diags).toHaveLength(0);
  });

  it("error diagnostic for unsupported capability", () => {
    const graph = makeGraph();
    const manifests: CapabilityManifest[] = [{
      "trigger.push": "native",
      "runtime.host": "native",
      // operation.shell missing → unsupported
    }];
    const diags = analyzeCapabilities(graph, manifests);
    expect(diags).toHaveLength(1);
    expect(diags[0]?.capability).toBe("operation.shell");
    expect(diags[0]?.support).toBe("unsupported");
    expect(diags[0]?.severity).toBe("error");
  });

  it("warning diagnostic for emulated capability", () => {
    const graph = makeGraph();
    const manifests: CapabilityManifest[] = [{
      "trigger.push": "native",
      "runtime.host": "native",
      "operation.shell": "emulated",
    }];
    const diags = analyzeCapabilities(graph, manifests);
    expect(diags).toHaveLength(1);
    expect(diags[0]?.support).toBe("emulated");
    expect(diags[0]?.severity).toBe("warning");
  });

  it("warning diagnostic for partial capability", () => {
    const graph = makeGraph();
    const manifests: CapabilityManifest[] = [{
      "trigger.push": "native",
      "runtime.host": "native",
      "operation.shell": "partial",
    }];
    const diags = analyzeCapabilities(graph, manifests);
    expect(diags).toHaveLength(1);
    expect(diags[0]?.support).toBe("partial");
    expect(diags[0]?.severity).toBe("warning");
  });

  it("no diagnostics for lowered capability", () => {
    const graph = makeGraph();
    const manifests: CapabilityManifest[] = [{
      "trigger.push": "native",
      "runtime.host": "native",
      "operation.shell": "lowered",
    }];
    const diags = analyzeCapabilities(graph, manifests);
    expect(diags).toHaveLength(0);
  });

  it("all unsupported when no manifests", () => {
    const graph = makeGraph();
    const diags = analyzeCapabilities(graph, []);
    expect(diags.length).toBeGreaterThan(0);
    for (const d of diags) {
      expect(d.support).toBe("unsupported");
      expect(d.severity).toBe("error");
    }
  });

  it("picks best support across multiple manifests", () => {
    const graph = makeGraph();
    const manifests: CapabilityManifest[] = [
      { "trigger.push": "native", "runtime.host": "native", "operation.shell": "unsupported" },
      { "operation.shell": "native" },
    ];
    const diags = analyzeCapabilities(graph, manifests);
    expect(diags).toHaveLength(0);
  });

  it("supports CapabilityDetail form", () => {
    const graph = makeGraph();
    const manifests: CapabilityManifest[] = [{
      "trigger.push": "native",
      "runtime.host": "native",
      "operation.shell": { support: "lowered", via: "bash" },
    }];
    const diags = analyzeCapabilities(graph, manifests);
    expect(diags).toHaveLength(0);
  });
});

describe("createPluginRegistry", () => {
  it("registers and retrieves plugins", () => {
    const registry = createPluginRegistry();
    const plugin = defineSverkaPlugin(() => ({
      name: "github",
      apiVersion: "sverka.dev/v1",
    }));
    registry.register(plugin);
    expect(registry.plugins).toHaveLength(1);
    expect(registry.plugins[0]?.name).toBe("github");
  });

  it("throws DUPLICATE_PLUGIN for same name", () => {
    const registry = createPluginRegistry();
    const p1 = defineSverkaPlugin(() => ({ name: "github", apiVersion: "v1" }));
    const p2 = defineSverkaPlugin(() => ({ name: "github", apiVersion: "v1" }));
    registry.register(p1);
    expect(() => registry.register(p2)).toThrow(PluginError);
    expect(() => registry.register(p2)).toThrow(/already registered/);
  });

  it("getCapabilities collects from all plugins", () => {
    const registry = createPluginRegistry();
    const p1 = defineSverkaPlugin(() => ({
      name: "github",
      apiVersion: "v1",
      capabilities: { "trigger.push": "native" },
    }));
    const p2 = defineSverkaPlugin(() => ({
      name: "gitlab",
      apiVersion: "v1",
      capabilities: { "trigger.push": "native", "runtime.container": "native" },
    }));
    registry.register(p1);
    registry.register(p2);
    const caps = registry.getCapabilities();
    expect(caps).toHaveLength(2);
  });

  it("getCapabilities skips plugins without capabilities", () => {
    const registry = createPluginRegistry();
    const p1 = defineSverkaPlugin(() => ({ name: "a", apiVersion: "v1" }));
    const p2 = defineSverkaPlugin(() => ({
      name: "b",
      apiVersion: "v1",
      capabilities: { "trigger.push": "native" },
    }));
    registry.register(p1);
    registry.register(p2);
    expect(registry.getCapabilities()).toHaveLength(1);
  });
});
