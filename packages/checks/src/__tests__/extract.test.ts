import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractFindings } from "../extract.js";
import { CheckError } from "../errors.js";
import type { CheckOutput } from "../resolver.js";
import { sampleSarif } from "./helpers/fixtures.js";

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), "sverka-checks-test-"));
}

describe("extractFindings — SARIF", () => {
  it("produces findings with correct checkId prefix", async () => {
    const dir = makeDir();
    writeFileSync(join(dir, "out.sarif"), JSON.stringify(sampleSarif()));
    const outputs: CheckOutput[] = [{ path: "out.sarif", format: "sarif" }];
    const findings = await extractFindings(outputs, dir, "mycheck");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.checkId).toContain("mycheck");
  });
});

describe("extractFindings — missing file", () => {
  it("returns empty array when output path does not exist", async () => {
    const dir = makeDir();
    const outputs: CheckOutput[] = [{ path: "missing.sarif", format: "sarif" }];
    const findings = await extractFindings(outputs, dir, "mycheck");
    expect(findings).toEqual([]);
  });
});

describe("extractFindings — non-SARIF format", () => {
  it("skips json format outputs", async () => {
    const dir = makeDir();
    writeFileSync(join(dir, "out.json"), JSON.stringify({ foo: "bar" }));
    const outputs: CheckOutput[] = [{ path: "out.json", format: "json" }];
    const findings = await extractFindings(outputs, dir, "mycheck");
    expect(findings).toEqual([]);
  });
});

describe("extractFindings — invalid SARIF", () => {
  it("throws CheckError(EXTRACTION_FAILED) with cause set", async () => {
    const dir = makeDir();
    writeFileSync(join(dir, "bad.sarif"), JSON.stringify({ version: "1.0.0", runs: [] }));
    const outputs: CheckOutput[] = [{ path: "bad.sarif", format: "sarif" }];
    try {
      await extractFindings(outputs, dir, "mycheck");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CheckError);
      const err = e as CheckError;
      expect(err.code).toBe("EXTRACTION_FAILED");
      expect(err.cause).toBeDefined();
    }
  });
});

describe("extractFindings — empty outputs", () => {
  it("returns empty array for no outputs", async () => {
    const dir = makeDir();
    const findings = await extractFindings([], dir, "mycheck");
    expect(findings).toEqual([]);
  });
});

describe("extractFindings — path traversal", () => {
  it("throws CheckError when output.path escapes artifactDir", async () => {
    const dir = makeDir();
    const outputs: CheckOutput[] = [{ path: "../../etc/passwd", format: "sarif" }];
    await expect(extractFindings(outputs, dir, "mycheck")).rejects.toBeInstanceOf(CheckError);
  });
});
