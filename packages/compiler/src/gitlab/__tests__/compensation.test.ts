// Spec 30 — Saga compensations: GitLab capability manifest.
// Test plan item 14.

import { describe, it, expect } from "vitest";
import { gitlabCapabilities } from "../capabilities.js";

describe("Spec 30 — GitLab policy.compensation capability (item 14)", () => {
  it("policy.compensation is emulated", () => {
    expect(gitlabCapabilities["policy.compensation"]).toBe("emulated");
  });
});
