import { describe, it, expect } from "vitest";
import { computeOperationId as irComputeOperationId } from "../ids.js";
import { computeOperationId as coreComputeOperationId } from "@sverka/core";

/**
 * ADR-006 cross-package consistency: the `ir` package re-exports
 * `computeOperationId` from `@sverka/core`, so both packages produce identical
 * ids by construction. This test asserts the re-export and pins the algorithm
 * with golden hashes to detect regression drift.
 */
describe("core / ir computeOperationId consistency (ADR-006)", () => {
  const cases: Array<[string, string, Record<string, unknown>, string]> = [
    ["run", "build", {}, "op-b75f0e7c4aa34a7f67cad8a4bfe9547ffe992a79736df1d6b19d28a5534e7bb6"],
    ["run", "build", { os: "linux" }, "op-ec9c1a04131e3bd5cb07b1eca9880930299e88c0a1b9b2f128655f670aaedd23"],
    ["run", "test", { node: "20", os: "linux" }, "op-1e54982274bd04562da23f5b6431a2d030990aaae2b2062786e12507268aaa51"],
    ["check", "lint", { command: "eslint", args: [".", "--fix"] }, "op-efbf3f2fbf0dbcf20f0ad5a420137613f764db02be66bbf2e9da7fadc7477a44"],
    ["build", "img", { userId: "user-assign", command: "docker build" }, "op-d059b9ff79ea5a6ad5dfb14804ccb549d202214497fb674301f5f0755fc4fab9"],
    ["run", "operation", { matrix: { node: ["20", "24"] } }, "op-6c62792d253f1b644914c733550a25ac604f7a07e397bddc63d3924b686e42a2"],
  ];

  it("ir re-exports the same function object from core", () => {
    expect(irComputeOperationId).toBe(coreComputeOperationId);
  });

  for (const [kind, name, context, expected] of cases) {
    it(`produces expected golden id for ${kind}/${name}/${JSON.stringify(context)}`, () => {
      expect(coreComputeOperationId(kind as never, name, context)).toBe(expected);
      expect(irComputeOperationId(kind as never, name, context)).toBe(expected);
    });
  }
});
