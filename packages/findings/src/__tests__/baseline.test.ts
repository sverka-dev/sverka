import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import {
  createBaseline,
  updateBaseline,
  compareBaseline,
  loadBaseline,
  saveBaseline,
  type Baseline,
} from "../baseline.js";
import { BaselineError } from "../errors.js";
import type { Finding } from "../types.js";
import {
  makeTempDir,
  cleanupTempDir,
  writeTempFile,
} from "./helpers/fixtures.js";

function makeFinding(
  overrides: Partial<Finding> & { fingerprint?: string } = {},
): Finding {
  const fingerprint = overrides.fingerprint ?? "fp-aaa";
  const checkId = overrides.checkId ?? "eslint:no-console";
  return {
    id: `${checkId}:${fingerprint}`,
    fingerprint,
    checkId,
    severity: "medium",
    confidence: 0.5,
    message: "msg",
    rule: "no-console",
    file: "src/index.ts",
    startLine: 10,
    endLine: 10,
    source: {
      tool: "eslint",
      version: "9.0.0",
      format: "sarif",
      originalRuleId: "no-console",
      originalSeverity: "warning",
    },
    ...overrides,
  };
}

describe("createBaseline", () => {
  it("returns a Baseline with all fingerprints", () => {
    const findings = [
      makeFinding({ fingerprint: "fp-a" }),
      makeFinding({ fingerprint: "fp-b" }),
    ];
    const baseline = createBaseline(findings);
    expect(baseline.fingerprints).toContain("fp-a");
    expect(baseline.fingerprints).toContain("fp-b");
  });

  it("sets version to 1", () => {
    expect(createBaseline([]).version).toBe(1);
  });

  it("has no suppressions", () => {
    expect(createBaseline([]).suppressions).toEqual([]);
  });

  it("createdAt and updatedAt are valid ISO 8601", () => {
    const baseline = createBaseline([]);
    expect(() => new Date(baseline.createdAt).toISOString()).not.toThrow();
    expect(() => new Date(baseline.updatedAt).toISOString()).not.toThrow();
  });

  it("dedupes duplicate fingerprints", () => {
    const findings = [
      makeFinding({ fingerprint: "fp-a" }),
      makeFinding({ fingerprint: "fp-a" }),
    ];
    const baseline = createBaseline(findings);
    expect(baseline.fingerprints.filter((f) => f === "fp-a")).toHaveLength(1);
  });
});

describe("updateBaseline", () => {
  it("adds new fingerprints", () => {
    const existing = createBaseline([makeFinding({ fingerprint: "fp-a" })]);
    const updated = updateBaseline(
      [makeFinding({ fingerprint: "fp-a" }), makeFinding({ fingerprint: "fp-b" })],
      existing,
    );
    expect(updated.fingerprints).toContain("fp-b");
  });

  it("removes resolved fingerprints", () => {
    const existing = createBaseline([
      makeFinding({ fingerprint: "fp-a" }),
      makeFinding({ fingerprint: "fp-b" }),
    ]);
    const updated = updateBaseline(
      [makeFinding({ fingerprint: "fp-a" })],
      existing,
    );
    expect(updated.fingerprints).not.toContain("fp-b");
  });

  it("removes suppressions for resolved fingerprints", () => {
    const existing = createBaseline([makeFinding({ fingerprint: "fp-a" })]);
    existing.suppressions = [
      {
        fingerprint: "fp-a",
        reason: "fp",
        author: "jane",
        createdAt: "2025-01-01T00:00:00Z",
      },
    ];
    const updated = updateBaseline([], existing);
    expect(updated.suppressions).toHaveLength(0);
  });

  it("preserves createdAt and refreshes updatedAt", () => {
    const existing = createBaseline([makeFinding({ fingerprint: "fp-a" })]);
    const originalCreatedAt = existing.createdAt;
    const updated = updateBaseline([makeFinding({ fingerprint: "fp-a" })], existing);
    expect(updated.createdAt).toBe(originalCreatedAt);
    // updatedAt may or may not differ, but should be valid ISO 8601.
    expect(() => new Date(updated.updatedAt).toISOString()).not.toThrow();
  });
});

describe("compareBaseline", () => {
  it("returns newFindings not in baseline", () => {
    const baseline = createBaseline([makeFinding({ fingerprint: "fp-a" })]);
    const diff = compareBaseline(
      [makeFinding({ fingerprint: "fp-a" }), makeFinding({ fingerprint: "fp-b" })],
      baseline,
    );
    expect(diff.newFindings).toHaveLength(1);
    expect(diff.newFindings[0]!.fingerprint).toBe("fp-b");
  });

  it("returns resolvedFingerprints in baseline but not current", () => {
    const baseline = createBaseline([
      makeFinding({ fingerprint: "fp-a" }),
      makeFinding({ fingerprint: "fp-b" }),
    ]);
    const diff = compareBaseline(
      [makeFinding({ fingerprint: "fp-a" })],
      baseline,
    );
    expect(diff.resolvedFingerprints).toContain("fp-b");
  });

  it("returns unchangedFindings in both", () => {
    const baseline = createBaseline([makeFinding({ fingerprint: "fp-a" })]);
    const diff = compareBaseline(
      [makeFinding({ fingerprint: "fp-a" })],
      baseline,
    );
    expect(diff.unchangedFindings).toHaveLength(1);
    expect(diff.unchangedFindings[0]!.fingerprint).toBe("fp-a");
  });

  it("empty current findings -> all baseline fingerprints resolved", () => {
    const baseline = createBaseline([
      makeFinding({ fingerprint: "fp-a" }),
      makeFinding({ fingerprint: "fp-b" }),
    ]);
    const diff = compareBaseline([], baseline);
    expect(diff.newFindings).toHaveLength(0);
    expect(diff.unchangedFindings).toHaveLength(0);
    expect(diff.resolvedFingerprints).toHaveLength(2);
  });

  it("empty baseline -> all findings new", () => {
    const baseline = createBaseline([]);
    const diff = compareBaseline(
      [makeFinding({ fingerprint: "fp-a" })],
      baseline,
    );
    expect(diff.newFindings).toHaveLength(1);
    expect(diff.unchangedFindings).toHaveLength(0);
    expect(diff.resolvedFingerprints).toHaveLength(0);
  });
});

describe("Baseline I/O", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it("saveBaseline writes a JSON file and returns void", async () => {
    const baseline = createBaseline([makeFinding({ fingerprint: "fp-a" })]);
    const filePath = `${dir}/baseline.json`;
    const result = await saveBaseline(baseline, filePath);
    const content = await readFile(filePath, "utf8");
    const parsed = JSON.parse(content) as Baseline;
    expect(parsed.version).toBe(1);
    expect(parsed.fingerprints).toContain("fp-a");
    // Spec: saveBaseline returns Promise<void>.
    expect(result).toBeUndefined();
  });

  it("loadBaseline reads and parses a JSON file", async () => {
    const baseline = createBaseline([makeFinding({ fingerprint: "fp-a" })]);
    await saveBaseline(baseline, `${dir}/baseline.json`);
    const loaded = await loadBaseline(`${dir}/baseline.json`);
    expect(loaded.fingerprints).toContain("fp-a");
    expect(loaded.version).toBe(1);
  });

  it("loadBaseline throws BASELINE_NOT_FOUND for missing file", async () => {
    await expect(loadBaseline(`${dir}/nope.json`)).rejects.toThrow(BaselineError);
    try {
      await loadBaseline(`${dir}/nope.json`);
    } catch (e) {
      expect((e as BaselineError).code).toBe("BASELINE_NOT_FOUND");
    }
  });

  it("loadBaseline throws BASELINE_INVALID for invalid JSON", async () => {
    await writeTempFile(dir, "bad.json", "{not valid json");
    await expect(loadBaseline(`${dir}/bad.json`)).rejects.toThrow(BaselineError);
    try {
      await loadBaseline(`${dir}/bad.json`);
    } catch (e) {
      expect((e as BaselineError).code).toBe("BASELINE_INVALID");
    }
  });

  it("loadBaseline throws BASELINE_INVALID for wrong schema version", async () => {
    await writeTempFile(
      dir,
      "wrong.json",
      JSON.stringify({ version: 99, fingerprints: [], suppressions: [] }),
    );
    await expect(loadBaseline(`${dir}/wrong.json`)).rejects.toThrow(BaselineError);
    try {
      await loadBaseline(`${dir}/wrong.json`);
    } catch (e) {
      expect((e as BaselineError).code).toBe("BASELINE_INVALID");
    }
  });

  it("loadBaseline throws BASELINE_INVALID when fingerprints is not an array", async () => {
    await writeTempFile(
      dir,
      "badfp.json",
      JSON.stringify({ version: 1, fingerprints: "oops", suppressions: [] }),
    );
    await expect(loadBaseline(`${dir}/badfp.json`)).rejects.toThrow(BaselineError);
  });

  it("saveBaseline throws BASELINE_WRITE_FAILED for unwritable path", async () => {
    const baseline = createBaseline([]);
    await expect(
      saveBaseline(baseline, `${dir}/nonexistent-dir/baseline.json`),
    ).rejects.toThrow(BaselineError);
    try {
      await saveBaseline(baseline, `${dir}/nonexistent-dir/baseline.json`);
    } catch (e) {
      expect((e as BaselineError).code).toBe("BASELINE_WRITE_FAILED");
    }
  });

  it("loadBaseline accepts extra unknown fields (forward-compat)", async () => {
    await writeTempFile(
      dir,
      "extra.json",
      JSON.stringify({
        version: 1,
        fingerprints: ["fp-a"],
        suppressions: [],
        extraField: "ignored",
      }),
    );
    const loaded = await loadBaseline(`${dir}/extra.json`);
    expect(loaded.fingerprints).toContain("fp-a");
  });
});
