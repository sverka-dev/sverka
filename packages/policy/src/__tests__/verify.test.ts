import { describe, it, expect } from "vitest";
import { verifyPolicyAgainstGraph } from "../verify.js";
import { DEFAULT_POLICY } from "../policy.js";
import type { Policy } from "../types.js";
import type { DefinitionGraph } from "@sverka/core";

function makeGraph(stepIds: string[]): DefinitionGraph {
  return {
    project: {
      id: "test",
      pipelines: [{
        id: "ci",
        inputs: {},
        entries: [],
        steps: stepIds.map((id) => ({
          id,
          runtime: { mode: "host" as const },
          operations: [{ kind: "shell" as const, command: "echo hi" }],
          inputs: [],
          outputs: [],
          dependencies: [],
        })),
        outputs: [],
      }],
    },
  };
}

function makePolicy(checkIds?: string[]): Policy {
  return {
    name: "test",
    default: "pass",
    failOn: checkIds
      ? [{ severity: "high", onlyNew: false, checkIds }]
      : [{ severity: "high", onlyNew: false }],
  };
}

describe("verifyPolicyAgainstGraph", () => {
  it("valid policy (all checkIds match) → valid=true", () => {
    const graph = makeGraph(["checks/typecheck", "checks/lint"]);
    const policy = makePolicy(["checks/typecheck", "checks/lint"]);
    const result = verifyPolicyAgainstGraph(policy, graph);
    expect(result.valid).toBe(true);
    expect(result.unknownCheckIds).toEqual([]);
  });

  it("unknown checkId → valid=false, listed", () => {
    const graph = makeGraph(["checks/typecheck"]);
    const policy = makePolicy(["checks/typecheck", "checks/unknown"]);
    const result = verifyPolicyAgainstGraph(policy, graph);
    expect(result.valid).toBe(false);
    expect(result.unknownCheckIds).toEqual(["checks/unknown"]);
  });

  it("policy with no checkIds → valid=true", () => {
    const graph = makeGraph(["checks/typecheck"]);
    const policy = makePolicy();
    const result = verifyPolicyAgainstGraph(policy, graph);
    expect(result.valid).toBe(true);
    expect(result.unknownCheckIds).toEqual([]);
  });

  it("multiple unknown checkIds → all listed", () => {
    const graph = makeGraph(["checks/typecheck"]);
    const policy = makePolicy(["checks/typecheck", "checks/foo", "checks/bar"]);
    const result = verifyPolicyAgainstGraph(policy, graph);
    expect(result.valid).toBe(false);
    expect(result.unknownCheckIds).toHaveLength(2);
    expect(result.unknownCheckIds).toContain("checks/foo");
    expect(result.unknownCheckIds).toContain("checks/bar");
  });

  it("DEFAULT_POLICY (no checkIds) → valid=true", () => {
    const graph = makeGraph([]);
    const result = verifyPolicyAgainstGraph(DEFAULT_POLICY, graph);
    expect(result.valid).toBe(true);
  });

  it("empty graph → unknown checkIds reported", () => {
    const graph = makeGraph([]);
    const policy = makePolicy(["checks/typecheck"]);
    const result = verifyPolicyAgainstGraph(policy, graph);
    expect(result.valid).toBe(false);
    expect(result.unknownCheckIds).toEqual(["checks/typecheck"]);
  });

  it("deduplicates checkIds across rules", () => {
    const graph = makeGraph(["checks/typecheck"]);
    const policy: Policy = {
      name: "test",
      default: "pass",
      failOn: [
        { severity: "high", onlyNew: false, checkIds: ["checks/unknown"] },
        { severity: "medium", onlyNew: false, checkIds: ["checks/unknown"] },
      ],
    };
    const result = verifyPolicyAgainstGraph(policy, graph);
    expect(result.valid).toBe(false);
    // "checks/unknown" appears in both rules but should be listed once.
    expect(result.unknownCheckIds).toEqual(["checks/unknown"]);
  });

  it("accepts bare checkIds that match checks/<id> steps", () => {
    const graph = makeGraph(["checks/typecheck", "checks/lint"]);
    const policy = makePolicy(["typecheck", "lint"]);
    const result = verifyPolicyAgainstGraph(policy, graph);
    expect(result.valid).toBe(true);
    expect(result.unknownCheckIds).toEqual([]);
  });

  it("ignores non-check steps when validating checkIds", () => {
    const graph = makeGraph(["build/compile"]);
    const policy = makePolicy(["compile"]);
    const result = verifyPolicyAgainstGraph(policy, graph);
    expect(result.valid).toBe(false);
    expect(result.unknownCheckIds).toEqual(["compile"]);
  });

  it("returns errors for malformed policy or graph without throwing", () => {
    const badPolicy = { name: "x" } as unknown as Policy;
    const badGraph = { project: {} } as unknown as DefinitionGraph;
    const result = verifyPolicyAgainstGraph(badPolicy, badGraph);
    expect(result.valid).toBe(false);
    expect(result.unknownCheckIds).toEqual([]);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThanOrEqual(1);
  });
});
