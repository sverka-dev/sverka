import { describe, it, expect } from "vitest";
import { missingBuildHint } from "../internal/errors.js";

describe("missingBuildHint", () => {
  it("returns a hint for a missing @sverka/* dist module", () => {
    const e = new Error(
      "Cannot find module '/repo/packages/cli/node_modules/@sverka/sdk/dist/index.mjs' imported from /repo/packages/cli/dist/main.mjs",
    );
    expect(missingBuildHint(e)).toContain("bun run build");
  });

  it("returns null for an unrelated missing module", () => {
    const e = new Error("Cannot find module 'left-pad'");
    expect(missingBuildHint(e)).toBeNull();
  });

  it("returns null for an unresolvable @sverka package (not a dist issue)", () => {
    const e = new Error(
      "Cannot find package '@sverka/workflow' imported from /tmp/proj/sverka.config.ts",
    );
    expect(missingBuildHint(e)).toBeNull();
  });
});
