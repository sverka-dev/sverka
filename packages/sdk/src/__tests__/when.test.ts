import { describe, it, expect } from "vitest";
import { when } from "../when.js";
import { env } from "../context.js";

describe("when", () => {
  it("returns the reference unchanged", () => {
    const ref = env.CI_TRACE!;
    expect(when(ref)).toBe(ref);
  });

  it("works with step references", () => {
    const ref = { kind: "step" as const, step: "build", output: "success", type: "boolean" as const };
    expect(when(ref)).toBe(ref);
  });
});
