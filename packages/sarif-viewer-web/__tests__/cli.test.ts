import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, writeFileSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BIN_PATH = join(import.meta.dirname, "..", "dist", "bin.mjs");
const binBuilt = existsSync(BIN_PATH);

/** Minimal valid SARIF 2.1.0 with one result. */
const VALID_SARIF = JSON.stringify({
  version: "2.1.0",
  runs: [
    {
      tool: { driver: { name: "test-tool" } },
      results: [
        {
          ruleId: "test-rule",
          level: "error",
          message: { text: "test message" },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: "test.ts" },
                region: { startLine: 1 },
              },
            },
          ],
        },
      ],
    },
  ],
});

describe("sarif-viewer-web CLI", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sarif-web-cli-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it.skipIf(!binBuilt)("--help prints usage and exits 0", () => {
    const result = spawnSync("node", [BIN_PATH, "--help"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage");
  });

  it.skipIf(!binBuilt)("reads SARIF from file, writes HTML to -o path", () => {
    const sarifPath = join(dir, "input.sarif");
    const outPath = join(dir, "report.html");
    writeFileSync(sarifPath, VALID_SARIF);
    const result = spawnSync("node", [BIN_PATH, sarifPath, "-o", outPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Wrote");
    expect(existsSync(outPath)).toBe(true);
    const html = readFileSync(outPath, "utf8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("test-rule");
  });

  it.skipIf(!binBuilt)("defaults output to sarif-report.html when no -o", () => {
    const sarifPath = join(dir, "input.sarif");
    writeFileSync(sarifPath, VALID_SARIF);
    const result = spawnSync("node", [BIN_PATH, sarifPath], {
      encoding: "utf8",
      cwd: dir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(result.status).toBe(0);
    expect(existsSync(join(dir, "sarif-report.html"))).toBe(true);
  });

  it.skipIf(!binBuilt)("exits 1 when no input provided", () => {
    const result = spawnSync("node", [BIN_PATH], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("sarif-viewer-web");
  });

  it.skipIf(!binBuilt)("exits 1 for nonexistent file argument", () => {
    const result = spawnSync("node", [BIN_PATH, "/nonexistent/path.sarif", "-o", join(dir, "out.html")], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("sarif-viewer-web");
  });

  it.skipIf(!binBuilt)("reads SARIF from stdin, writes HTML to -o path", () => {
    const outPath = join(dir, "stdin-report.html");
    const result = spawnSync("node", [BIN_PATH, "-o", outPath], {
      encoding: "utf8",
      input: VALID_SARIF,
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(result.status).toBe(0);
    expect(existsSync(outPath)).toBe(true);
    const html = readFileSync(outPath, "utf8");
    expect(html).toContain("test-tool");
  });
});
