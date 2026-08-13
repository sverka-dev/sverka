import { describe, it, expect } from "vitest";
import { synthesizeCheckSteps } from "../synthesize.js";
import { createBuiltinResolver } from "../resolver.js";
import type { CheckResolver } from "../resolver.js";
import { makeCheck, makeContext } from "./helpers/fixtures.js";

describe("synthesizeCheckSteps", () => {
  it("converts proposed checks to StepDefinitions", () => {
    const ctx = makeContext(["bun"]);
    const checks = [makeCheck("typecheck"), makeCheck("lint"), makeCheck("test")];
    const steps = synthesizeCheckSteps(checks, ctx, createBuiltinResolver());
    expect(steps).toHaveLength(3);
    expect(steps[0]!.id).toBe("checks/typecheck");
    expect(steps[1]!.id).toBe("checks/lint");
    expect(steps[2]!.id).toBe("checks/test");
  });

  it("skips checks that fail resolution", () => {
    const ctx = makeContext(["bun"]);
    const checks = [makeCheck("typecheck"), makeCheck("clippy"), makeCheck("lint")];
    // clippy requires cargo, not bun — should be skipped.
    const steps = synthesizeCheckSteps(checks, ctx, createBuiltinResolver());
    expect(steps).toHaveLength(2);
    expect(steps.map((s) => s.id)).toEqual(["checks/typecheck", "checks/lint"]);
  });

  it("deduplicates by checkId", () => {
    const ctx = makeContext(["bun"]);
    const checks = [makeCheck("typecheck"), makeCheck("typecheck"), makeCheck("lint")];
    const steps = synthesizeCheckSteps(checks, ctx, createBuiltinResolver());
    expect(steps).toHaveLength(2);
    expect(steps.map((s) => s.id)).toEqual(["checks/typecheck", "checks/lint"]);
  });

  it("step IDs follow checks/<checkId> pattern", () => {
    const ctx = makeContext(["bun"]);
    const checks = [makeCheck("typecheck")];
    const steps = synthesizeCheckSteps(checks, ctx, createBuiltinResolver());
    expect(steps[0]!.id).toMatch(/^checks\//);
  });

  it("steps have runtime.mode === host", () => {
    const ctx = makeContext(["bun"]);
    const checks = [makeCheck("typecheck"), makeCheck("lint"), makeCheck("test")];
    const steps = synthesizeCheckSteps(checks, ctx, createBuiltinResolver());
    for (const step of steps) {
      expect(step.runtime.mode).toBe("host");
    }
  });

  it("returns empty array for empty input", () => {
    const ctx = makeContext(["bun"]);
    const steps = synthesizeCheckSteps([], ctx, createBuiltinResolver());
    expect(steps).toHaveLength(0);
  });

  it("works with custom resolver", () => {
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
          outputs: [],
        };
      },
    };
    const ctx = makeContext([]);
    const checks = [makeCheck("custom1"), makeCheck("custom2")];
    const steps = synthesizeCheckSteps(checks, ctx, custom);
    expect(steps).toHaveLength(2);
    expect(steps[0]!.id).toBe("checks/custom1");
  });
});
