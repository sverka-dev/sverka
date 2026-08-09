import { describe, it, expect } from "vitest";
import { when } from "../../composables/when.js";
import { run } from "../../composables/run.js";

describe("when()", () => {
  it("attaches the condition string to the operation spec", () => {
    const op = run({ command: "full-scan" });
    const guarded = when("schedule == 'nightly'", op);
    expect(guarded.spec.condition).toBe("schedule == 'nightly'");
    // underlying op unchanged
    expect(op.spec.condition).toBeUndefined();
  });

  it("preserves the kind and other spec fields", () => {
    const op = run({ kind: "check", command: "scan", image: "node:24" });
    const guarded = when("true", op);
    expect(guarded.kind).toBe("check");
    expect(guarded.spec.command).toBe("scan");
    expect(guarded.spec.image).toBe("node:24");
  });

  it("is lazy: never throws at call time", () => {
    expect(() => when("!!!malformed", run({ command: "x" }))).not.toThrow();
  });
});
