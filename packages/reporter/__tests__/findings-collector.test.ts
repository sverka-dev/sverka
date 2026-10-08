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

  it("throws ReporterError COLLECTION_FAILED when artifact dir does not exist", async () => {
    await expect(
      collectFindings({ artifactDir: join(dir, "nonexistent") }),
    ).rejects.toMatchObject({
      name: "ReporterError",
      code: "COLLECTION_FAILED",
    });
  });

  it("returns empty array when artifact dir is empty", async () => {
    const rows = await collectFindings({ artifactDir: dir });
    expect(rows).toHaveLength(0);
  });

  it("reads SARIF from one step directory, normalizes, attributes to stepId", async () => {
    const stepDir = join(dir, "ci/lint");
    await mkdir(stepDir, { recursive: true });
    await writeFile(
      join(stepDir, "results.sarif"),
      JSON.stringify(SAMPLE_SARIF),
    );

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

    await expect(collectFindings({ artifactDir: dir })).rejects.toThrow(
      ReporterError,
    );
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
    await writeFile(
      join(stepDir, "results.json"),
      JSON.stringify(SAMPLE_SARIF),
    );
    await writeFile(join(stepDir, "log.txt"), "some log");

    const rows = await collectFindings({ artifactDir: dir });
    expect(rows).toHaveLength(0);
  });

  it("reads .sarif.json extension too", async () => {
    const stepDir = join(dir, "ci/lint");
    await mkdir(stepDir, { recursive: true });
    await writeFile(
      join(stepDir, "results.sarif.json"),
      JSON.stringify(SAMPLE_SARIF),
    );

    const rows = await collectFindings({ artifactDir: dir });
    expect(rows).toHaveLength(1);
  });

  it("handles empty SARIF (no results)", async () => {
    const stepDir = join(dir, "ci/lint");
    await mkdir(stepDir, { recursive: true });
    await writeFile(
      join(stepDir, "results.sarif"),
      JSON.stringify(EMPTY_SARIF),
    );

    const rows = await collectFindings({ artifactDir: dir });
    expect(rows).toHaveLength(0);
  });

  it("scopes collection to <artifactDir>/<runId> when runId is given", async () => {
    const runA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const runB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await mkdir(join(dir, runA, "ci/lint"), { recursive: true });
    await mkdir(join(dir, runB, "ci/lint"), { recursive: true });
    // A finding left behind by an earlier/concurrent run.
    await writeFile(
      join(dir, runB, "ci/lint", "results.sarif"),
      JSON.stringify(SAMPLE_SARIF),
    );
    await writeFile(
      join(dir, runA, "ci/lint", "results.sarif"),
      JSON.stringify(SAMPLE_SARIF),
    );

    const rows = await collectFindings({ artifactDir: dir, runId: runA });
    expect(rows).toHaveLength(1);
    // stepId is derived relative to the run dir, not the artifact root.
    expect(rows[0]!.stepId).toBe("ci/lint");
  });

  it("ignores legacy flat-layout artifacts when runId is given", async () => {
    // Pre-run-id artifacts sit at <artifactDir>/<stepId>/ — a scoped
    // collection must not attribute them to this run.
    await mkdir(join(dir, "ci/lint"), { recursive: true });
    await writeFile(
      join(dir, "ci/lint", "results.sarif"),
      JSON.stringify(SAMPLE_SARIF),
    );

    const rows = await collectFindings({
      artifactDir: dir,
      runId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });
    expect(rows).toHaveLength(0);
  });

  it("returns empty when the run dir is missing but artifactDir exists", async () => {
    const rows = await collectFindings({
      artifactDir: dir,
      runId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    });
    expect(rows).toHaveLength(0);
  });

  it("still throws COLLECTION_FAILED when artifactDir itself is missing (runId set)", async () => {
    await expect(
      collectFindings({
        artifactDir: join(dir, "nonexistent"),
        runId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      }),
    ).rejects.toMatchObject({
      name: "ReporterError",
      code: "COLLECTION_FAILED",
    });
  });

  it("rejects a runId that escapes the artifact dir", async () => {
    await expect(
      collectFindings({ artifactDir: dir, runId: "../escape" }),
    ).rejects.toMatchObject({
      name: "ReporterError",
      code: "COLLECTION_FAILED",
    });
  });

  it("skips SARIF files older than sinceMs, keeps fresh ones", async () => {
    const { utimes } = await import("node:fs/promises");
    const staleDir = join(dir, "ci/stale");
    const freshDir = join(dir, "ci/fresh");
    await mkdir(staleDir, { recursive: true });
    await mkdir(freshDir, { recursive: true });
    const staleFile = join(staleDir, "results.sarif");
    await writeFile(staleFile, JSON.stringify(SAMPLE_SARIF));
    await writeFile(
      join(freshDir, "results.sarif"),
      JSON.stringify(SAMPLE_SARIF),
    );

    const now = Date.now();
    // Stale = minutes before the run start, well past the mtime epsilon.
    const staleTime = (now - 60_000) / 1000;
    await utimes(staleFile, staleTime, staleTime);

    const rows = await collectFindings({ artifactDir: dir, sinceMs: now });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.stepId).toBe("ci/fresh");
  });
});
