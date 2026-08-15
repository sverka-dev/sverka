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
import type { DefinitionGraph, OperationDefinition, Input, OutputDefinition, ArtifactAccess, EnvironmentAction, EnvironmentTier, CachePolicy } from "@sverka/core";

function makeGraph(opts: {
  triggerKind?: "push" | "changeRequest" | "manual";
  runtimeMode?: "host" | "container";
  hasDeps?: boolean;
  hasShell?: boolean;
  hasScalarOutput?: boolean;
  hasArtifactOutput?: boolean;
  hasEnv?: boolean;
  hasSecrets?: boolean;
  hasPipelineSecretInput?: boolean;
  artifactRetention?: string;
  artifactAccess?: ArtifactAccess;
  interruptible?: boolean;
  permissions?: Record<string, "read" | "write" | "none">;
  defaults?: { shell?: string; workdir?: string; beforeScript?: readonly string[]; interruptible?: boolean };
  runner?: { labels: readonly string[]; group?: string };
  identity?: { tokens: Readonly<Record<string, { audience: string }>> };
  rules?: readonly { if?: string; changes?: readonly string[]; exists?: readonly string[]; when?: "on_success" | "on_failure" | "always" | "never" | "manual" }[];
  reports?: readonly { type: string; path: string; format?: string }[];
  inputs?: Record<string, Input>;
  services?: readonly { name: string; image: string; ports?: readonly number[] }[];
  environment?: { name: string; action?: EnvironmentAction; tier?: EnvironmentTier };
  cache?: { paths: readonly string[]; key: string; restoreKeys?: readonly string[]; policy?: CachePolicy };
  concurrency?: { group: string; cancelInProgress?: boolean };
} = {}): DefinitionGraph {
  const triggerKind = opts.triggerKind ?? "push";
  const runtimeMode = opts.runtimeMode ?? "host";
  const outputs: OutputDefinition[] = [];
  if (opts.hasScalarOutput) outputs.push({ name: "result", type: "string" });
  if (opts.hasArtifactOutput) outputs.push({ name: "dist", type: "artifact", path: "./dist", ...(opts.artifactRetention !== undefined ? { retention: opts.artifactRetention } : {}), ...(opts.artifactAccess !== undefined ? { access: opts.artifactAccess } : {}) });

  const runtime: { mode: "host" | "container"; env?: Record<string, string>; secrets?: string[] } = { mode: runtimeMode };
  if (opts.hasEnv) runtime.env = { NODE_ENV: "production" };
  if (opts.hasSecrets) runtime.secrets = ["NPM_TOKEN"];

  const inputs: Record<string, { type: "string"; secret?: boolean; required?: boolean }> = {};
  if (opts.hasPipelineSecretInput) inputs.npmToken = { type: "string", secret: true, required: true };

  return {
    project: {
      id: "test",
      pipelines: [{
        id: "ci",
        inputs,
        entries: [{
          id: "on-push",
          trigger: { kind: triggerKind },
          roots: ["build"],
        }],
        steps: [{
          id: "build",
          runtime,
          operations: [
            ...(opts.hasShell === false ? [] : [{ kind: "shell", command: "echo hi" }]),
            ...(opts.hasArtifactOutput ? [{
              kind: "exportArtifact",
              name: "dist",
              path: "./dist",
              ...(opts.artifactRetention !== undefined ? { retention: opts.artifactRetention } : {}),
              ...(opts.artifactAccess !== undefined ? { access: opts.artifactAccess } : {}),
            }] : []),
            ...(opts.reports ?? []).map((r) => ({ kind: "report", spec: r }) as OperationDefinition),
          ] as readonly OperationDefinition[],
          inputs: [],
          outputs,
          dependencies: opts.hasDeps ? [{ kind: "control", producer: "lint" }] : [],
          ...(opts.interruptible !== undefined ? { interruptible: opts.interruptible } : {}),
          ...(opts.runner !== undefined ? { runner: opts.runner } : {}),
          ...(opts.identity !== undefined ? { identity: opts.identity } : {}),
          ...(opts.rules !== undefined ? { rules: opts.rules } : {}),
          ...(opts.services !== undefined ? { services: opts.services } : {}),
          ...(opts.environment !== undefined ? { environment: opts.environment } : {}),
          ...(opts.cache !== undefined ? { cache: opts.cache } : {}),
          ...(opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
        }],
        outputs: [],
        ...(opts.permissions !== undefined ? { permissions: opts.permissions } : {}),
        ...(opts.defaults !== undefined ? { defaults: opts.defaults } : {}),
        ...(opts.inputs !== undefined ? { inputs: opts.inputs } : {}),
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

  it("passes options to the factory", () => {
    const plugin = defineSverkaPlugin((options) => ({
      name: "github",
      apiVersion: "sverka.dev/v1",
      capabilities: options?.foo === "bar" ? { "trigger.push": "native" } : {},
    }), { foo: "bar" } as unknown as Record<string, unknown>);
    expect((plugin.capabilities as CapabilityManifest)["trigger.push"]).toBe("native");
  });

  it("throws INVALID_PLUGIN for missing name", () => {
    try {
      defineSverkaPlugin(() => ({ name: "", apiVersion: "v1" }));
      throw new Error("expected INVALID_PLUGIN");
    } catch (err) {
      expect(err).toBeInstanceOf(PluginError);
      expect((err as PluginError).code).toBe("INVALID_PLUGIN");
    }
  });

  it("throws INVALID_PLUGIN for missing apiVersion", () => {
    try {
      defineSverkaPlugin(() => ({ name: "test", apiVersion: "" }));
      throw new Error("expected INVALID_PLUGIN");
    } catch (err) {
      expect(err).toBeInstanceOf(PluginError);
      expect((err as PluginError).code).toBe("INVALID_PLUGIN");
    }
  });

  it("throws INVALID_CAPABILITY for invalid capabilities", () => {
    try {
      defineSverkaPlugin(() => ({
        name: "bad",
        apiVersion: "v1",
        capabilities: { "trigger.push": "totally-invalid" as never },
      }));
      throw new Error("expected INVALID_CAPABILITY");
    } catch (err) {
      expect(err).toBeInstanceOf(PluginError);
      expect((err as PluginError).code).toBe("INVALID_CAPABILITY");
    }
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

  it("detects environment.variables from runtime.env (F-20)", () => {
    const caps = detectCapabilities(makeGraph({ hasEnv: true }));
    expect(caps.has("environment.variables")).toBe(true);
  });

  it("does not detect environment.variables when no env", () => {
    const caps = detectCapabilities(makeGraph({ hasEnv: false }));
    expect(caps.has("environment.variables")).toBe(false);
  });

  it("detects secrets.runtime from runtime.secrets (F-21)", () => {
    const caps = detectCapabilities(makeGraph({ hasSecrets: true }));
    expect(caps.has("secrets.runtime")).toBe(true);
  });

  it("does not detect secrets.runtime when no secrets", () => {
    const caps = detectCapabilities(makeGraph({ hasSecrets: false }));
    expect(caps.has("secrets.runtime")).toBe(false);
  });

  it("detects secrets.pipeline-input from pipeline secret inputs (F-21)", () => {
    const caps = detectCapabilities(makeGraph({ hasPipelineSecretInput: true }));
    expect(caps.has("secrets.pipeline-input")).toBe(true);
  });

  it("does not detect secrets.pipeline-input when no secret inputs", () => {
    const caps = detectCapabilities(makeGraph({ hasPipelineSecretInput: false }));
    expect(caps.has("secrets.pipeline-input")).toBe(false);
  });

  it("detects concurrency.interruptible when step.interruptible === true", () => {
    const caps = detectCapabilities(makeGraph({ interruptible: true }));
    expect(caps.has("concurrency.interruptible")).toBe(true);
  });

  it("does not detect concurrency.interruptible when step.interruptible === false", () => {
    const caps = detectCapabilities(makeGraph({ interruptible: false }));
    expect(caps.has("concurrency.interruptible")).toBe(false);
  });

  it("does not detect concurrency.interruptible when omitted", () => {
    const caps = detectCapabilities(makeGraph());
    expect(caps.has("concurrency.interruptible")).toBe(false);
  });

  it("detects environment.permissions when pipeline has permissions", () => {
    const caps = detectCapabilities(makeGraph({ permissions: { contents: "read" } }));
    expect(caps.has("environment.permissions")).toBe(true);
  });

  it("does not detect environment.permissions when omitted", () => {
    const caps = detectCapabilities(makeGraph());
    expect(caps.has("environment.permissions")).toBe(false);
  });

  it("detects runner.selection when step has runner", () => {
    const caps = detectCapabilities(makeGraph({ runner: { labels: ["linux"] } }));
    expect(caps.has("runner.selection")).toBe(true);
  });

  it("detects runner.group when step has runner with group", () => {
    const caps = detectCapabilities(makeGraph({ runner: { labels: ["linux"], group: "g1" } }));
    expect(caps.has("runner.group")).toBe(true);
  });

  it("does not detect runner.group when runner has no group", () => {
    const caps = detectCapabilities(makeGraph({ runner: { labels: ["linux"] } }));
    expect(caps.has("runner.group")).toBe(false);
  });

  it("does not detect runner.selection when omitted", () => {
    const caps = detectCapabilities(makeGraph());
    expect(caps.has("runner.selection")).toBe(false);
  });

  it("detects secrets.oidc when step has identity", () => {
    const caps = detectCapabilities(makeGraph({
      identity: { tokens: { AWS: { audience: "https://sts.amazonaws.com" } } },
    }));
    expect(caps.has("secrets.oidc")).toBe(true);
  });

  it("detects secrets.oidc.multiAudience when multiple audiences", () => {
    const caps = detectCapabilities(makeGraph({
      identity: {
        tokens: {
          AWS: { audience: "https://sts.amazonaws.com" },
          VAULT: { audience: "https://vault.example.com" },
        },
      },
    }));
    expect(caps.has("secrets.oidc.multiAudience")).toBe(true);
  });

  it("does not detect secrets.oidc.multiAudience when single audience", () => {
    const caps = detectCapabilities(makeGraph({
      identity: { tokens: { AWS: { audience: "https://sts.amazonaws.com" } } },
    }));
    expect(caps.has("secrets.oidc.multiAudience")).toBe(false);
  });

  it("does not detect secrets.oidc when omitted", () => {
    const caps = detectCapabilities(makeGraph());
    expect(caps.has("secrets.oidc")).toBe(false);
  });

  it("detects workflow.rules when step has rules", () => {
    const caps = detectCapabilities(makeGraph({ rules: [{ if: "$X" }] }));
    expect(caps.has("workflow.rules")).toBe(true);
  });

  it("detects workflow.rules.changes when a rule has changes", () => {
    const caps = detectCapabilities(makeGraph({ rules: [{ changes: ["src/**"] }] }));
    expect(caps.has("workflow.rules.changes")).toBe(true);
  });

  it("detects workflow.rules.exists when a rule has exists", () => {
    const caps = detectCapabilities(makeGraph({ rules: [{ exists: ["Makefile"] }] }));
    expect(caps.has("workflow.rules.exists")).toBe(true);
  });

  it("does not detect workflow.rules when omitted", () => {
    const caps = detectCapabilities(makeGraph());
    expect(caps.has("workflow.rules")).toBe(false);
  });

  it("detects workflow.defaults when pipeline has defaults", () => {
    const caps = detectCapabilities(makeGraph({ defaults: { shell: "bash" } }));
    expect(caps.has("workflow.defaults")).toBe(true);
  });

  it("detects workflow.defaults.shell when defaults has shell", () => {
    const caps = detectCapabilities(makeGraph({ defaults: { shell: "bash" } }));
    expect(caps.has("workflow.defaults.shell")).toBe(true);
  });

  it("detects workflow.defaults.beforeScript when defaults has beforeScript", () => {
    const caps = detectCapabilities(makeGraph({ defaults: { beforeScript: ["install"] } }));
    expect(caps.has("workflow.defaults.beforeScript")).toBe(true);
  });

  it("does not detect workflow.defaults when omitted", () => {
    const caps = detectCapabilities(makeGraph());
    expect(caps.has("workflow.defaults")).toBe(false);
  });

  it("detects artifact.report when step has reports", () => {
    const caps = detectCapabilities(makeGraph({ reports: [{ type: "junit", path: "test.xml" }] }));
    expect(caps.has("artifact.report")).toBe(true);
  });

  it("detects artifact.report.junit for junit report", () => {
    const caps = detectCapabilities(makeGraph({ reports: [{ type: "junit", path: "test.xml" }] }));
    expect(caps.has("artifact.report.junit")).toBe(true);
  });

  it("detects artifact.report.sarif for sarif report", () => {
    const caps = detectCapabilities(makeGraph({ reports: [{ type: "sarif", path: "results.sarif" }] }));
    expect(caps.has("artifact.report.sarif")).toBe(true);
  });

  it("does not detect artifact.report when omitted", () => {
    const caps = detectCapabilities(makeGraph());
    expect(caps.has("artifact.report")).toBe(false);
  });

  it("detects workflow.inputs when pipeline has inputs", () => {
    const caps = detectCapabilities(makeGraph({ inputs: { env: { type: "string" } } }));
    expect(caps.has("workflow.inputs")).toBe(true);
  });

  it("detects workflow.inputs.choice for choice type", () => {
    const caps = detectCapabilities(makeGraph({ inputs: { env: { type: "choice", options: ["a"] } } }));
    expect(caps.has("workflow.inputs.choice")).toBe(true);
  });

  it("detects workflow.inputs.array for array type", () => {
    const caps = detectCapabilities(makeGraph({ inputs: { targets: { type: "array" } } }));
    expect(caps.has("workflow.inputs.array")).toBe(true);
  });

  it("detects workflow.inputs.pattern when input has pattern", () => {
    const caps = detectCapabilities(makeGraph({ inputs: { ver: { type: "string", pattern: "^v" } } }));
    expect(caps.has("workflow.inputs.pattern")).toBe(true);
  });

  it("does not detect workflow.inputs when omitted", () => {
    const caps = detectCapabilities(makeGraph());
    expect(caps.has("workflow.inputs")).toBe(false);
  });

  it("detects environment.services when step has services", () => {
    const caps = detectCapabilities(makeGraph({ services: [{ name: "pg", image: "postgres:16" }] }));
    expect(caps.has("environment.services")).toBe(true);
  });

  it("detects environment.services.ports when service has ports", () => {
    const caps = detectCapabilities(makeGraph({ services: [{ name: "pg", image: "postgres:16", ports: [5432] }] }));
    expect(caps.has("environment.services.ports")).toBe(true);
  });

  it("does not detect environment.services.ports when no ports", () => {
    const caps = detectCapabilities(makeGraph({ services: [{ name: "pg", image: "postgres:16" }] }));
    expect(caps.has("environment.services.ports")).toBe(false);
  });

  it("does not detect environment.services when omitted", () => {
    const caps = detectCapabilities(makeGraph());
    expect(caps.has("environment.services")).toBe(false);
  });

  it("detects deployment.environment when step has environment", () => {
    const caps = detectCapabilities(makeGraph({ environment: { name: "prod" } }));
    expect(caps.has("deployment.environment")).toBe(true);
  });

  it("detects deployment.environment.action when environment has action", () => {
    const caps = detectCapabilities(makeGraph({ environment: { name: "prod", action: "stop" } }));
    expect(caps.has("deployment.environment.action")).toBe(true);
  });

  it("detects deployment.environment.tier when environment has tier", () => {
    const caps = detectCapabilities(makeGraph({ environment: { name: "prod", tier: "production" } }));
    expect(caps.has("deployment.environment.tier")).toBe(true);
  });

  it("does not detect deployment.environment when omitted", () => {
    const caps = detectCapabilities(makeGraph());
    expect(caps.has("deployment.environment")).toBe(false);
  });

  it("detects artifact.retention when artifact output has retention", () => {
    const caps = detectCapabilities(makeGraph({ hasArtifactOutput: true, artifactRetention: "7d" }));
    expect(caps.has("artifact.retention")).toBe(true);
  });

  it("detects artifact.access when artifact output has access", () => {
    const caps = detectCapabilities(makeGraph({ hasArtifactOutput: true, artifactAccess: "developer" }));
    expect(caps.has("artifact.access")).toBe(true);
  });

  it("does not detect artifact.retention when omitted", () => {
    const caps = detectCapabilities(makeGraph({ hasArtifactOutput: true }));
    expect(caps.has("artifact.retention")).toBe(false);
  });

  it("detects cache when step has cache", () => {
    const caps = detectCapabilities(makeGraph({ cache: { paths: ["node_modules"], key: "k" } }));
    expect(caps.has("cache")).toBe(true);
  });

  it("detects cache.policy when cache has policy", () => {
    const caps = detectCapabilities(makeGraph({ cache: { paths: ["node_modules"], key: "k", policy: "pull" } }));
    expect(caps.has("cache.policy")).toBe(true);
  });

  it("detects cache.fallbackKeys when cache has restoreKeys", () => {
    const caps = detectCapabilities(makeGraph({ cache: { paths: ["node_modules"], key: "k", restoreKeys: ["fallback"] } }));
    expect(caps.has("cache.fallbackKeys")).toBe(true);
  });

  it("does not detect cache when omitted", () => {
    const caps = detectCapabilities(makeGraph());
    expect(caps.has("cache")).toBe(false);
  });

  it("detects concurrency.group when step has concurrency", () => {
    const caps = detectCapabilities(makeGraph({ concurrency: { group: "prod" } }));
    expect(caps.has("concurrency.group")).toBe(true);
  });

  it("detects concurrency.cancelInProgress when set", () => {
    const caps = detectCapabilities(makeGraph({ concurrency: { group: "prod", cancelInProgress: true } }));
    expect(caps.has("concurrency.cancelInProgress")).toBe(true);
  });

  it("does not detect concurrency when omitted", () => {
    const caps = detectCapabilities(makeGraph());
    expect(caps.has("concurrency.group")).toBe(false);
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

  it("info diagnostic for connector capability", () => {
    const graph = makeGraph();
    const manifests: CapabilityManifest[] = [{
      "trigger.push": "native",
      "runtime.host": "native",
      "operation.shell": "connector",
    }];
    const diags = analyzeCapabilities(graph, manifests);
    expect(diags).toHaveLength(1);
    expect(diags[0]?.support).toBe("connector");
    expect(diags[0]?.severity).toBe("info");
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
    try {
      registry.register(p2);
      throw new Error("expected DUPLICATE_PLUGIN");
    } catch (err) {
      expect(err).toBeInstanceOf(PluginError);
      expect((err as PluginError).code).toBe("DUPLICATE_PLUGIN");
    }
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

  it("plugins getter returns a defensive array copy", () => {
    const registry = createPluginRegistry();
    const p1 = defineSverkaPlugin(() => ({ name: "a", apiVersion: "v1" }));
    registry.register(p1);
    const plugins = registry.plugins as { name: string; apiVersion: string }[];
    plugins.push(
      defineSverkaPlugin(() => ({ name: "b", apiVersion: "v1" })),
    );
    expect(registry.plugins).toHaveLength(1);
  });

  it("returned plugin objects cannot mutate registry state", () => {
    const registry = createPluginRegistry();
    const p1 = defineSverkaPlugin(() => ({ name: "a", apiVersion: "v1" }));
    registry.register(p1);
    const stored = registry.plugins[0];
    (stored as { name: string }).name = "b";
    expect(registry.plugins[0]?.name).toBe("a");
    expect(() =>
      registry.register(
        defineSverkaPlugin(() => ({ name: "b", apiVersion: "v1" })),
      ),
    ).not.toThrow();
  });

  it("getCapabilities returns defensive manifest copies", () => {
    const registry = createPluginRegistry();
    const p1 = defineSverkaPlugin(() => ({
      name: "a",
      apiVersion: "v1",
      capabilities: { "trigger.push": "native" },
    }));
    registry.register(p1);
    const caps = registry.getCapabilities();
    (caps[0] as Record<string, string>)["trigger.push"] = "unsupported";
    expect(registry.getCapabilities()[0]?.["trigger.push"]).toBe("native");
  });

  it("getCapabilities returns defensive copies of nested CapabilityDetail objects", () => {
    const registry = createPluginRegistry();
    const p1 = defineSverkaPlugin(() => ({
      name: "a",
      apiVersion: "v1",
      capabilities: { "trigger.push": { support: "native", via: "github" } },
    }));
    registry.register(p1);
    const caps = registry.getCapabilities();
    const detail = caps[0]?.["trigger.push"] as { support: string; via: string };
    detail.support = "unsupported";
    detail.via = "gitlab";
    const stored = registry.getCapabilities()[0]?.["trigger.push"] as { support: string; via: string };
    expect(stored.support).toBe("native");
    expect(stored.via).toBe("github");
  });

  it("defineSverkaPlugin snapshots nested CapabilityDetail objects defensively", () => {
    const manifest: CapabilityManifest = { "trigger.push": { support: "native", via: "github" } };
    const plugin = defineSverkaPlugin(() => ({
      name: "a",
      apiVersion: "v1",
      capabilities: manifest,
    }));
    const detail = manifest["trigger.push"] as { support: string; via: string };
    detail.support = "unsupported";
    detail.via = "gitlab";
    const stored = plugin.capabilities?.["trigger.push"] as { support: string; via: string };
    expect(stored.support).toBe("native");
    expect(stored.via).toBe("github");
  });
});
