// Spec 30 — Saga compensations: GitHub capability manifest.
// Test plan item 14.

import { describe, it, expect } from "vitest";
import { githubCapabilities } from "../capabilities.js";

describe("Spec 30 — GitHub policy.compensation capability (item 14)", () => {
  it("policy.compensation is emulated", () => {
    expect(githubCapabilities["policy.compensation"]).toBe("emulated");
  });
});
