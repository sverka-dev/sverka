import { describe, it, expect } from "vitest";
import { computeOperationId as irComputeOperationId } from "../ids.js";
import { computeOperationId as coreComputeOperationId } from "@sverka/core";

/**
 * ADR-006 cross-package consistency: core and ir implement
 * `computeOperationId` independently (core owns the planning-time
 * assignment; ir owns the validation-time recompute). Both must produce
 * byte-identical op- ids for the same inputs. This test guards against drift.
 */
describe("core / ir computeOperationId consistency (ADR-006)", () => {
  const cases: Array<[string, string, Record<string, unknown>]> = [
    ["run", "build", {}],
    ["run", "build", { os: "linux" }],
    ["run", "test", { node: "20", os: "linux" }],
    ["check", "lint", { command: "eslint", args: [".", "--fix"] }],
    ["build", "img", { userId: "user-assign", command: "docker build" }],
    ["run", "operation", { matrix: { node: ["20", "24"] } }],
  ];

  for (const [kind, name, context] of cases) {
    it(`core === ir for computeOperationId(${kind}, ${name}, ${JSON.stringify(context)})`, () => {
      expect(coreComputeOperationId(kind as never, name, context)).toBe(
        irComputeOperationId(kind as never, name, context),
      );
    });
  }
});
