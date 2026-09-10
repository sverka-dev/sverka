import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveFindings } from "../src/input.js";
import { DEFAULT_NORMALIZE_CONTEXT } from "@sverka/verification";
import { makeFinding, makeSarif } from "./helpers/fixtures.js";
import type { Finding } from "@sverka/verification";

describe("resolveFindings", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sarif-web-input-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("findings provided: passthrough (no normalization)", () => {
    const findings: Finding[] = [makeFinding()];
    const result = resolveFindings({ findings });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(findings[0].id);
  });

  it("findings provided: returns a copy, not the same reference", () => {
    const findings: Finding[] = [makeFinding()];
    const result = resolveFindings({ findings });
    expect(result).not.toBe(findings);
    expect(result).toEqual(findings);
  });

  it("sarif provided: normalizes internally", () => {
    const sarif = makeSarif([
      { ruleId: "test-rule", message: "test msg", file: "a.ts", startLine: 5 },
    ]) as never;
    const result = resolveFindings({ sarif });
    expect(result).toHaveLength(1);
    expect(result[0].rule).toBe("test-rule");
    expect(result[0].file).toBe("a.ts");
  });

  it("sarifPath provided: reads file and normalizes", () => {
    const sarifPath = join(dir, "test.sarif");
    writeFileSync(
      sarifPath,
      JSON.stringify(
        makeSarif([
          { ruleId: "r1", message: "msg", file: "b.ts", startLine: 1 },
        ]),
      ),
    );
    const result = resolveFindings({ sarifPath });
    expect(result).toHaveLength(1);
    expect(result[0].rule).toBe("r1");
  });

  it("throws when no input provided", () => {
    expect(() => resolveFindings({})).toThrow("provide exactly one");
  });

  it("throws when more than one input provided", () => {
    const findings = [makeFinding()];
    const sarif = makeSarif() as never;
    expect(() => resolveFindings({ findings, sarif })).toThrow("provide only one");
  });

  it("throws when sarifPath and findings both provided", () => {
    const findings = [makeFinding()];
    expect(() =>
      resolveFindings({ findings, sarifPath: "/tmp/x.sarif" }),
    ).toThrow("provide only one");
  });

  it("uses custom context when provided", () => {
    const sarif = makeSarif([
      { ruleId: "ctx-rule", message: "msg", file: "c.ts", startLine: 1 },
    ]) as never;
    const result = resolveFindings({
      sarif,
      context: {
        root: "/custom",
        checkIdPrefix: "prefix",
        defaultConfidence: 0.9,
      },
    });
    expect(result).toHaveLength(1);
    expect(result[0].checkId).toBe("prefix:ctx-rule");
  });

  it("DEFAULT_NORMALIZE_CONTEXT has expected shape", () => {
    expect(DEFAULT_NORMALIZE_CONTEXT.checkIdPrefix).toBe("");
    expect(DEFAULT_NORMALIZE_CONTEXT.defaultConfidence).toBe(0.5);
  });
});
