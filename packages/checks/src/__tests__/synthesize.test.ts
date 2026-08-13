import { describe, it, expect } from "vitest";
import { synthesizeCheckSteps } from "../synthesize.js";
import { createBuiltinResolver } from "../resolver.js";
import type { CheckResolver } from "../resolver.js";
import { makeCheck, makeContext } from "./helpers/fixtures.js";

describe("synthesizeCheckSteps", () => {
  it("converts proposed checks to StepDefinitions", () => {
    const ctx = makeContext(["bun"]);
    const checks = [makeCheck("typecheck"), makeCheck("lint"), makeCheck("test")];
    const resolved = synthesizeCheckSteps(checks, ctx, createBuiltinResolver());
    expect(resolved).toHaveLength(3);
    expect(resolved[0]!.step.id).toBe("checks/typecheck");
    expect(resolved[1]!.step.id).toBe("checks/lint");
    expect(resolved[2]!.step.id).toBe("checks/test");
  });

  it("skips checks that fail resolution", () => {
    const ctx = makeContext(["bun"]);
    const checks = [makeCheck("typecheck"), makeCheck("clippy"), makeCheck("lint")];
    // clippy requires cargo, not bun — should be skipped.
    const resolved = synthesizeCheckSteps(checks, ctx, createBuiltinResolver());
    expect(resolved).toHaveLength(2);
    expect(resolved.map((r) => r.step.id)).toEqual(["checks/typecheck", "checks/lint"]);
  });

  it("deduplicates by checkId", () => {
    const ctx = makeContext(["bun"]);
    const checks = [makeCheck("typecheck"), makeCheck("typecheck"), makeCheck("lint")];
    const resolved = synthesizeCheckSteps(checks, ctx, createBuiltinResolver());
    expect(resolved).toHaveLength(2);
    expect(resolved.map((r) => r.step.id)).toEqual(["checks/typecheck", "checks/lint"]);
  });

  it("step IDs follow checks/<checkId> pattern", () => {
    const ctx = makeContext(["bun"]);
    const checks = [makeCheck("typecheck")];
    const resolved = synthesizeCheckSteps(checks, ctx, createBuiltinResolver());
    expect(resolved[0]!.step.id).toMatch(/^checks\//);
  });

  it("steps have runtime.mode === host", () => {
    const ctx = makeContext(["bun"]);
    const checks = [makeCheck("typecheck"), makeCheck("lint"), makeCheck("test")];
    const resolved = synthesizeCheckSteps(checks, ctx, createBuiltinResolver());
    for (const r of resolved) {
      expect(r.step.runtime.mode).toBe("host");
    }
  });

  it("returns empty array for empty input", () => {
    const ctx = makeContext(["bun"]);
    const resolved = synthesizeCheckSteps([], ctx, createBuiltinResolver());
    expect(resolved).toHaveLength(0);
  });

  it("preserves outputs from custom resolvers", () => {
    const custom: CheckResolver = {
      resolve(check) {
        return {
          checkId: check.checkId,
          step: {
            id: `checks/${check.checkId}`,
            runtime: { mode: "host" },
            operations: [{ kind: "shell", command: "echo hello" }],
            inputs: [],
            outputs: [],
            dependencies: [],
          },
          outputs: [{ path: "out.sarif", format: "sarif" }],
        };
      },
    };
    const ctx = makeContext([]);
    const checks = [makeCheck("custom1"), makeCheck("custom2")];
    const resolved = synthesizeCheckSteps(checks, ctx, custom);
    expect(resolved).toHaveLength(2);
    expect(resolved[0]!.step.id).toBe("checks/custom1");
    expect(resolved[0]!.outputs).toEqual([{ path: "out.sarif", format: "sarif" }]);
  });
});
