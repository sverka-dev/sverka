import { describe, it, expect } from "vitest";
import { isSuppressed, filterSuppressed, filterOnlyNew } from "../suppress.js";
import { createBaseline, type Baseline } from "../baseline.js";
import type { Finding } from "../types.js";

function makeFinding(fingerprint: string): Finding {
  return {
    id: `check:${fingerprint}`,
    fingerprint,
    checkId: "check",
    severity: "medium",
    confidence: 0.5,
    message: "msg",
    rule: "rule",
    file: "src/index.ts",
    startLine: 1,
    endLine: 1,
    source: {
      tool: "eslint",
      version: null,
      format: "sarif",
      originalRuleId: "rule",
      originalSeverity: null,
    },
  };
}

function baselineWith(
  fingerprints: string[],
  suppressions: Baseline["suppressions"] = [],
): Baseline {
  const b = createBaseline(fingerprints.map(makeFinding));
  b.suppressions = suppressions;
  return b;
}

describe("isSuppressed", () => {
  it("returns true for matching non-expired suppression", () => {
    const baseline = baselineWith(
      ["fp-a"],
      [
        {
          fingerprint: "fp-a",
          reason: "false positive",
          author: "jane",
          createdAt: "2025-01-01T00:00:00Z",
        },
      ],
    );
    expect(isSuppressed(makeFinding("fp-a"), baseline)).toBe(true);
  });

  it("returns false when no suppression matches", () => {
    const baseline = baselineWith(
      ["fp-a"],
      [
        {
          fingerprint: "fp-b",
          reason: "other",
          author: "jane",
          createdAt: "2025-01-01T00:00:00Z",
        },
      ],
    );
    expect(isSuppressed(makeFinding("fp-a"), baseline)).toBe(false);
  });

  it("returns false for expired suppression (expiresAt in the past)", () => {
    const baseline = baselineWith(
      ["fp-a"],
      [
        {
          fingerprint: "fp-a",
          reason: "expired",
          author: "jane",
          createdAt: "2025-01-01T00:00:00Z",
          expiresAt: "2020-01-01T00:00:00Z",
        },
      ],
    );
    expect(isSuppressed(makeFinding("fp-a"), baseline)).toBe(false);
  });

  it("returns true for suppression with no expiresAt", () => {
    const baseline = baselineWith(
      ["fp-a"],
      [
        {
          fingerprint: "fp-a",
          reason: "permanent",
          author: "jane",
          createdAt: "2025-01-01T00:00:00Z",
        },
      ],
    );
    expect(isSuppressed(makeFinding("fp-a"), baseline)).toBe(true);
  });

  it("returns true for suppression with future expiresAt", () => {
    const future = new Date(
      Date.now() + 365 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const baseline = baselineWith(
      ["fp-a"],
      [
        {
          fingerprint: "fp-a",
          reason: "temporary",
          author: "jane",
          createdAt: "2025-01-01T00:00:00Z",
          expiresAt: future,
        },
      ],
    );
    expect(isSuppressed(makeFinding("fp-a"), baseline)).toBe(true);
  });
});

describe("filterSuppressed", () => {
  it("excludes suppressed findings when includeSuppressed is false", () => {
    const baseline = baselineWith(
      ["fp-a", "fp-b"],
      [
        {
          fingerprint: "fp-a",
          reason: "fp",
          author: "jane",
          createdAt: "2025-01-01T00:00:00Z",
        },
      ],
    );
    const findings = [makeFinding("fp-a"), makeFinding("fp-b")];
    const filtered = filterSuppressed(findings, baseline, false);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.fingerprint).toBe("fp-b");
  });

  it("includes all findings when includeSuppressed is true", () => {
    const baseline = baselineWith(
      ["fp-a"],
      [
        {
          fingerprint: "fp-a",
          reason: "fp",
          author: "jane",
          createdAt: "2025-01-01T00:00:00Z",
        },
      ],
    );
    const findings = [makeFinding("fp-a"), makeFinding("fp-b")];
    const filtered = filterSuppressed(findings, baseline, true);
    expect(filtered).toHaveLength(2);
  });

  it("excludes expired suppressions", () => {
    const baseline = baselineWith(
      ["fp-a"],
      [
        {
          fingerprint: "fp-a",
          reason: "expired",
          author: "jane",
          createdAt: "2025-01-01T00:00:00Z",
          expiresAt: "2020-01-01T00:00:00Z",
        },
      ],
    );
    const findings = [makeFinding("fp-a")];
    const filtered = filterSuppressed(findings, baseline, false);
    expect(filtered).toHaveLength(1);
  });
});

describe("filterOnlyNew", () => {
  it("returns only findings not in baseline fingerprints", () => {
    const baseline = baselineWith(["fp-a"]);
    const findings = [makeFinding("fp-a"), makeFinding("fp-b")];
    const result = filterOnlyNew(findings, baseline);
    expect(result).toHaveLength(1);
    expect(result[0]!.fingerprint).toBe("fp-b");
  });

  it("excludes suppressed findings even if not in baseline fingerprints", () => {
    const baseline = baselineWith(
      [],
      [
        {
          fingerprint: "fp-c",
          reason: "fp",
          author: "jane",
          createdAt: "2025-01-01T00:00:00Z",
        },
      ],
    );
    const findings = [makeFinding("fp-b"), makeFinding("fp-c")];
    const result = filterOnlyNew(findings, baseline);
    expect(result).toHaveLength(1);
    expect(result[0]!.fingerprint).toBe("fp-b");
  });

  it("returns all findings when baseline is empty", () => {
    const baseline = baselineWith([]);
    const findings = [makeFinding("fp-a"), makeFinding("fp-b")];
    const result = filterOnlyNew(findings, baseline);
    expect(result).toHaveLength(2);
  });

  it("returns empty when all findings are in baseline", () => {
    const baseline = baselineWith(["fp-a", "fp-b"]);
    const findings = [makeFinding("fp-a"), makeFinding("fp-b")];
    const result = filterOnlyNew(findings, baseline);
    expect(result).toHaveLength(0);
  });
});
