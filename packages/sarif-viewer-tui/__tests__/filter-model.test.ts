import { describe, it, expect } from "vitest";
import {
  SEVERITY_FILTERS,
  filterBySeverity,
  searchFindings,
  severityRank,
  sortFindings,
} from "../src/filter-model.js";
import { makeFinding } from "./helpers/fixtures.js";

describe("filter-model", () => {
  it("SEVERITY_FILTERS has 6 entries: all, critical, high, medium, low, info", () => {
    expect(SEVERITY_FILTERS).toEqual([
      "all",
      "critical",
      "high",
      "medium",
      "low",
      "info",
    ]);
  });

  it("severityRank: critical > high > medium > low > info", () => {
    expect(severityRank("critical")).toBeGreaterThan(severityRank("high"));
    expect(severityRank("high")).toBeGreaterThan(severityRank("medium"));
    expect(severityRank("medium")).toBeGreaterThan(severityRank("low"));
    expect(severityRank("low")).toBeGreaterThan(severityRank("info"));
  });

  it("filterBySeverity: all returns everything", () => {
    const findings = [
      makeFinding({ fingerprint: "a", severity: "high" }),
      makeFinding({ fingerprint: "b", severity: "low" }),
    ];
    expect(filterBySeverity(findings, "all")).toHaveLength(2);
  });

  it("filterBySeverity: filters by severity level", () => {
    const findings = [
      makeFinding({ fingerprint: "a", severity: "high" }),
      makeFinding({ fingerprint: "b", severity: "low" }),
      makeFinding({ fingerprint: "c", severity: "high" }),
    ];
    expect(filterBySeverity(findings, "high")).toHaveLength(2);
    expect(filterBySeverity(findings, "low")).toHaveLength(1);
    expect(filterBySeverity(findings, "critical")).toHaveLength(0);
  });

  it("searchFindings: empty query returns all", () => {
    const findings = [makeFinding({ fingerprint: "a" })];
    expect(searchFindings(findings, "")).toHaveLength(1);
  });

  it("searchFindings: matches across message, checkId, file, rule", () => {
    const findings = [
      makeFinding({ fingerprint: "a", message: "alpha bug" }),
      makeFinding({ fingerprint: "b", checkId: "ci/alpha", message: "other" }),
      makeFinding({ fingerprint: "c", file: "src/alpha.ts", message: "other" }),
      makeFinding({ fingerprint: "d", rule: "alpha-rule", message: "other" }),
      makeFinding({ fingerprint: "e", message: "unrelated" }),
    ];
    const result = searchFindings(findings, "alpha");
    expect(result).toHaveLength(4);
  });

  it("searchFindings: case-insensitive", () => {
    const findings = [makeFinding({ fingerprint: "a", message: "ALPHA bug" })];
    expect(searchFindings(findings, "alpha")).toHaveLength(1);
  });

  it("sortFindings: none preserves original order", () => {
    const findings = [
      makeFinding({ fingerprint: "a", file: "z.ts", severity: "low" }),
      makeFinding({ fingerprint: "b", file: "a.ts", severity: "high" }),
    ];
    const sorted = sortFindings(findings, "none");
    expect(sorted[0]!.fingerprint).toBe("a");
    expect(sorted[1]!.fingerprint).toBe("b");
  });

  it("sortFindings: severity descending (critical first)", () => {
    const findings = [
      makeFinding({ fingerprint: "a", severity: "low" }),
      makeFinding({ fingerprint: "b", severity: "critical" }),
      makeFinding({ fingerprint: "c", severity: "high" }),
    ];
    const sorted = sortFindings(findings, "severity");
    expect(sorted[0]!.severity).toBe("critical");
    expect(sorted[1]!.severity).toBe("high");
    expect(sorted[2]!.severity).toBe("low");
  });

  it("sortFindings: severity is stable for equal keys", () => {
    const findings = [
      makeFinding({ fingerprint: "a", severity: "high", message: "first" }),
      makeFinding({ fingerprint: "b", severity: "low" }),
      makeFinding({ fingerprint: "c", severity: "high", message: "second" }),
    ];
    const sorted = sortFindings(findings, "severity");
    expect(sorted[0]!.fingerprint).toBe("a");
    expect(sorted[1]!.fingerprint).toBe("c");
    expect(sorted[2]!.fingerprint).toBe("b");
  });

  it("sortFindings: file alphabetical, then startLine", () => {
    const findings = [
      makeFinding({ fingerprint: "a", file: "z.ts", startLine: 1 }),
      makeFinding({ fingerprint: "b", file: "a.ts", startLine: 5 }),
      makeFinding({ fingerprint: "c", file: "a.ts", startLine: 2 }),
    ];
    const sorted = sortFindings(findings, "file");
    expect(sorted[0]!.fingerprint).toBe("c");
    expect(sorted[1]!.fingerprint).toBe("b");
    expect(sorted[2]!.fingerprint).toBe("a");
  });

  it("sortFindings: rule alphabetical", () => {
    const findings = [
      makeFinding({ fingerprint: "a", rule: "zebra" }),
      makeFinding({ fingerprint: "b", rule: "alpha" }),
    ];
    const sorted = sortFindings(findings, "rule");
    expect(sorted[0]!.rule).toBe("alpha");
    expect(sorted[1]!.rule).toBe("zebra");
  });
});
