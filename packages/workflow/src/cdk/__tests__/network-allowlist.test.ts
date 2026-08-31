// Tests for NetworkAllowlist model + synthesis validation.
// Spec 26 — items 1, 2, 3, 11.

import { describe, it, expect } from "vitest";
import { Project, Pipeline, ShellStep, Entry, type NetworkAllowlist, type Runtime } from "../index.js";
import { synthesize, SynthesisError } from "../../core/index.js";

describe("NetworkAllowlist model (Spec 26 item 11)", () => {
  it("NetworkAllowlist is exported and usable", () => {
    const allowlist: NetworkAllowlist = { allowed: ["registry.npmjs.org"] };
    expect(allowlist.allowed).toEqual(["registry.npmjs.org"]);
  });

  it("Runtime accepts network field", () => {
    const runtime: Runtime = { mode: "container", network: { allowed: ["github.com"] } };
    expect(runtime.network?.allowed).toEqual(["github.com"]);
  });

  it("Runtime without network field is valid", () => {
    const runtime: Runtime = { mode: "host" };
    expect(runtime.network).toBeUndefined();
  });
});

describe("NetworkAllowlist synthesis (Spec 26 items 1, 2, 3)", () => {
  it("item 1: network.allowed synthesizes onto StepDefinition.runtime.network", () => {
    const project = new Project("net-test");
    const pipeline = new Pipeline(project, "ci");
    new ShellStep(pipeline, "build", {
      runtime: { mode: "host", network: { allowed: ["registry.npmjs.org"] } },
      command: "echo hello",
    });
    new Entry(pipeline, "main", { trigger: { kind: "push" }, roots: ["build"] });

    const graph = synthesize(project);
    const step = graph.project.pipelines[0]!.steps.find((s) => s.id === "ci/build");
    expect(step).toBeDefined();
    expect(step!.runtime.network).toEqual({ allowed: ["registry.npmjs.org"] });
  });

  it("item 3: network.allowed: [] synthesizes (empty = deny all, valid)", () => {
    const project = new Project("net-empty");
    const pipeline = new Pipeline(project, "ci");
    new ShellStep(pipeline, "build", {
      runtime: { mode: "host", network: { allowed: [] } },
      command: "echo hello",
    });
    new Entry(pipeline, "main", { trigger: { kind: "push" }, roots: ["build"] });

    const graph = synthesize(project);
    const step = graph.project.pipelines[0]!.steps.find((s) => s.id === "ci/build");
    expect(step!.runtime.network).toEqual({ allowed: [] });
  });

  it("item 2: network.allowed with empty string throws INVALID_NETWORK_ALLOWLIST", () => {
    const project = new Project("net-invalid");
    const pipeline = new Pipeline(project, "ci");
    new ShellStep(pipeline, "build", {
      runtime: { mode: "host", network: { allowed: [""] } },
      command: "echo hello",
    });
    new Entry(pipeline, "main", { trigger: { kind: "push" }, roots: ["build"] });

    expect(() => synthesize(project)).toThrow(SynthesisError);
    try {
      synthesize(project);
    } catch (e) {
      expect(e).toBeInstanceOf(SynthesisError);
      expect((e as SynthesisError).code).toBe("INVALID_NETWORK_ALLOWLIST");
    }
  });
});
