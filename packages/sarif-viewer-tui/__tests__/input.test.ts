import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveFindings } from "../src/input.js";
import { makeFinding, makeSarif } from "./helpers/fixtures.js";

describe("input — resolveFindings", () => {
  it("findings provided: passthrough (no normalization)", () => {
    const findings = [makeFinding({ fingerprint: "x", message: "direct" })];
    const result = resolveFindings({ findings });
    expect(result).toHaveLength(1);
    expect(result[0]!.message).toBe("direct");
  });

  it("findings provided: returns a copy, not the same reference", () => {
    const findings = [makeFinding({ fingerprint: "x" })];
    const result = resolveFindings({ findings });
    expect(result).not.toBe(findings);
    expect(result).toEqual(findings);
  });

  it("sarif provided: normalizes internally", () => {
    const sarif = makeSarif([
      { ruleId: "no-undef", message: "undefined var", file: "a.ts", startLine: 5 },
    ]);
    const result = resolveFindings({ sarif: sarif as never });
    expect(result).toHaveLength(1);
    expect(result[0]!.rule).toBe("no-undef");
    expect(result[0]!.file).toBe("a.ts");
    expect(result[0]!.startLine).toBe(5);
  });

  it("sarifPath provided: reads file and normalizes", () => {
    const dir = mkdtempSync(join(tmpdir(), "sarif-tui-"));
    const sarifPath = join(dir, "report.sarif");
    const sarif = makeSarif([
      { ruleId: "r1", message: "msg one", file: "b.ts", startLine: 1 },
      { ruleId: "r2", message: "msg two", file: "c.ts", startLine: 20 },
    ]);
    writeFileSync(sarifPath, JSON.stringify(sarif));
    const result = resolveFindings({ sarifPath });
    expect(result).toHaveLength(2);
    expect(result[0]!.rule).toBe("r1");
    expect(result[1]!.file).toBe("c.ts");
  });

  it("throws when no input provided", () => {
    expect(() => resolveFindings({})).toThrow(/exactly one/i);
  });

  it("throws when more than one input provided", () => {
    const findings = [makeFinding()];
    const sarif = makeSarif([]);
    expect(() =>
      resolveFindings({ findings, sarif: sarif as never }),
    ).toThrow(/only one/i);
  });

  it("throws when sarifPath and findings both provided", () => {
    const findings = [makeFinding()];
    expect(() =>
      resolveFindings({ findings, sarifPath: "/tmp/x.sarif" }),
    ).toThrow(/only one/i);
  });

  it("uses custom context when provided", () => {
    const sarif = makeSarif([
      { ruleId: "r1", message: "m", file: "x.ts", startLine: 1 },
    ]);
    const result = resolveFindings({
      sarif: sarif as never,
      context: { root: "/custom", checkIdPrefix: "tool", defaultConfidence: 0.9 },
    });
    expect(result[0]!.checkId).toContain("tool");
    expect(result[0]!.confidence).toBe(0.9);
  });
});
