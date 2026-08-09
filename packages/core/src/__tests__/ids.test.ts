import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { computeOperationId } from "../internal/ids.js";
import { canonicalStringify } from "../internal/canonical.js";

const OP_ID_RE = /^op-[0-9a-f]{64}$/;

describe("computeOperationId", () => {
  it("is prefixed with op- followed by 64 hex chars", () => {
    const id = computeOperationId("run", "build", {});
    expect(id).toMatch(OP_ID_RE);
  });

  it("is deterministic for identical inputs", () => {
    expect(computeOperationId("run", "build", { os: "linux" })).toBe(
      computeOperationId("run", "build", { os: "linux" }),
    );
  });

  it("is independent of context key insertion order", () => {
    const a = computeOperationId("run", "build", { os: "linux", arch: "x64" });
    const b = computeOperationId("run", "build", { arch: "x64", os: "linux" });
    expect(a).toBe(b);
  });

  it("differs across kinds", () => {
    expect(computeOperationId("run", "build", {})).not.toBe(
      computeOperationId("check", "build", {}),
    );
  });

  it("differs across names", () => {
    expect(computeOperationId("run", "build", {})).not.toBe(
      computeOperationId("run", "test", {}),
    );
  });

  it("differs across context values", () => {
    expect(computeOperationId("run", "build", { os: "linux" })).not.toBe(
      computeOperationId("run", "build", { os: "macos" }),
    );
  });

  it("matrix expansion produces distinct, deterministic ids", () => {
    const combos = [
      { os: "linux", arch: "x64" },
      { os: "linux", arch: "arm64" },
      { os: "macos", arch: "x64" },
      { os: "macos", arch: "arm64" },
    ];
    const ids = combos.map((c) => computeOperationId("run", "build", c));
    expect(new Set(ids).size).toBe(ids.length);
    expect(combos.map((c) => computeOperationId("run", "build", c))).toEqual(ids);
  });

  it("matches a manual sha256 over the canonical JSON of {kind,name,context}", () => {
    const kind = "run";
    const name = "build";
    const context = { os: "linux", arch: "x64" };
    const expected =
      "op-" +
      createHash("sha256")
        .update(canonicalStringify({ kind, name, context }), "utf8")
        .digest("hex");
    expect(computeOperationId(kind, name, context)).toBe(expected);
  });
});
