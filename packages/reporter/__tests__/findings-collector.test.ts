import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectFindings } from "../src/findings-collector.js";
import { ReporterError } from "../src/errors.js";
import { SAMPLE_SARIF, EMPTY_SARIF } from "./helpers/fixtures.js";

describe("FindingsCollector", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "reporter-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns empty array when artifact dir does not exist", async () => {
    const rows = await collectFindings({ artifactDir: join(dir, "nonexistent") });
    expect(rows).toHaveLength(0);
  });

  it("returns empty array when artifact dir is empty", async () => {
    const rows = await collectFindings({ artifactDir: dir });
    expect(rows).toHaveLength(0);
  });

  it("reads SARIF from one step directory, normalizes, attributes to stepId", async () => {
    const stepDir = join(dir, "ci/lint");
    await mkdir(stepDir, { recursive: true });
    await writeFile(join(stepDir, "results.sarif"), JSON.stringify(SAMPLE_SARIF));

    const rows = await collectFindings({ artifactDir: dir });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.stepId).toBe("ci/lint");
    expect(rows[0]!.finding.checkId).toContain("rule-1");
    expect(rows[0]!.finding.message).toBe("Test finding");
  });

  it("merges findings from multiple step directories", async () => {
    const step1 = join(dir, "ci/lint");
    const step2 = join(dir, "ci/test");
    await mkdir(step1, { recursive: true });
    await mkdir(step2, { recursive: true });
    await writeFile(join(step1, "results.sarif"), JSON.stringify(SAMPLE_SARIF));
    await writeFile(join(step2, "results.sarif"), JSON.stringify(SAMPLE_SARIF));

    const rows = await collectFindings({ artifactDir: dir });
    expect(rows).toHaveLength(2);
    const stepIds = rows.map((r) => r.stepId).sort();
    expect(stepIds).toEqual(["ci/lint", "ci/test"]);
  });

  it("throws ReporterError COLLECTION_FAILED for invalid JSON", async () => {
    const stepDir = join(dir, "ci/lint");
    await mkdir(stepDir, { recursive: true });
    await writeFile(join(stepDir, "results.sarif"), "not valid json {{{");

    await expect(collectFindings({ artifactDir: dir })).rejects.toThrow(ReporterError);
    try {
      await collectFindings({ artifactDir: dir });
    } catch (e) {
      expect(e).toBeInstanceOf(ReporterError);
      expect((e as ReporterError).code).toBe("COLLECTION_FAILED");
    }
  });

  it("ignores files without .sarif extension", async () => {
    const stepDir = join(dir, "ci/lint");
    await mkdir(stepDir, { recursive: true });
    await writeFile(join(stepDir, "results.json"), JSON.stringify(SAMPLE_SARIF));
    await writeFile(join(stepDir, "log.txt"), "some log");

    const rows = await collectFindings({ artifactDir: dir });
    expect(rows).toHaveLength(0);
  });

  it("reads .sarif.json extension too", async () => {
    const stepDir = join(dir, "ci/lint");
    await mkdir(stepDir, { recursive: true });
    await writeFile(join(stepDir, "results.sarif.json"), JSON.stringify(SAMPLE_SARIF));

    const rows = await collectFindings({ artifactDir: dir });
    expect(rows).toHaveLength(1);
  });

  it("handles empty SARIF (no results)", async () => {
    const stepDir = join(dir, "ci/lint");
    await mkdir(stepDir, { recursive: true });
    await writeFile(join(stepDir, "results.sarif"), JSON.stringify(EMPTY_SARIF));

    const rows = await collectFindings({ artifactDir: dir });
    expect(rows).toHaveLength(0);
  });
});
