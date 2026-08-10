import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { computeFingerprint } from "../fingerprint.js";
import { NormalizationError } from "../errors.js";
import type { FingerprintInput } from "../types.js";

function baseInput(
  overrides: Partial<FingerprintInput> = {},
): FingerprintInput {
  return {
    rule: "no-console",
    file: "src/index.ts",
    startLine: 10,
    endLine: 10,
    checkId: "eslint:no-console",
    ...overrides,
  };
}

describe("computeFingerprint", () => {
  it("produces identical fingerprints for identical inputs", () => {
    const a = computeFingerprint(baseInput());
    const b = computeFingerprint(baseInput());
    expect(a).toBe(b);
  });

  it("produces different fingerprints for different rule", () => {
    const a = computeFingerprint(baseInput({ rule: "no-console" }));
    const b = computeFingerprint(baseInput({ rule: "no-debugger" }));
    expect(a).not.toBe(b);
  });

  it("produces different fingerprints for different file", () => {
    const a = computeFingerprint(baseInput({ file: "src/a.ts" }));
    const b = computeFingerprint(baseInput({ file: "src/b.ts" }));
    expect(a).not.toBe(b);
  });

  it("produces different fingerprints for different line range", () => {
    const a = computeFingerprint(baseInput({ startLine: 10, endLine: 10 }));
    const b = computeFingerprint(baseInput({ startLine: 10, endLine: 12 }));
    expect(a).not.toBe(b);
  });

  it("produces different fingerprints for different checkId", () => {
    const a = computeFingerprint(baseInput({ checkId: "eslint:no-console" }));
    const b = computeFingerprint(baseInput({ checkId: "custom:no-console" }));
    expect(a).not.toBe(b);
  });

  it("is insensitive to message and severity (not in input)", () => {
    // FingerprintInput has no message/severity fields, so this is structural.
    const a = computeFingerprint(baseInput());
    const b = computeFingerprint(baseInput());
    expect(a).toBe(b);
  });

  it("normalizes Windows backslash paths to forward slashes", () => {
    const a = computeFingerprint(baseInput({ file: "src\\index.ts" }));
    const b = computeFingerprint(baseInput({ file: "src/index.ts" }));
    expect(a).toBe(b);
  });

  it("outputs lowercase hex SHA-256 (64 chars)", () => {
    const fp = computeFingerprint(baseInput());
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches manual sha256 of the canonical string", () => {
    const input = baseInput();
    const expected = createHash("sha256")
      .update(
        `${input.checkId}|${input.rule}|${input.file}|${input.startLine}|${input.endLine}`,
      )
      .digest("hex");
    expect(computeFingerprint(input)).toBe(expected);
  });

  it("allows empty rule (SARIF edge case: ruleId defaults to empty)", () => {
    expect(() => computeFingerprint(baseInput({ rule: "" }))).not.toThrow();
  });

  it("allows empty checkId (SARIF edge case: empty prefix + empty ruleId)", () => {
    expect(() => computeFingerprint(baseInput({ checkId: "" }))).not.toThrow();
  });

  it("throws INVALID_FINGERPRINT_INPUT for empty file", () => {
    expect(() => computeFingerprint(baseInput({ file: "" }))).toThrow(
      NormalizationError,
    );
  });

  it("throws INVALID_FINGERPRINT_INPUT for zero startLine", () => {
    expect(() => computeFingerprint(baseInput({ startLine: 0 }))).toThrow(
      NormalizationError,
    );
  });

  it("throws INVALID_FINGERPRINT_INPUT for zero endLine", () => {
    expect(() => computeFingerprint(baseInput({ endLine: 0 }))).toThrow(
      NormalizationError,
    );
  });
});
