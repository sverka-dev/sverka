import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, writeFileSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VALID_SARIF_JSON } from "@sverka/verification";

const BIN_PATH = join(import.meta.dirname, "..", "dist", "bin.mjs");
const binBuilt = existsSync(BIN_PATH);

describe("sarif-viewer-tui CLI", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sarif-cli-"));
  });

  afterEach(() => {
    spawnSync("rm", ["-rf", dir]);
  });

  it.skipIf(!binBuilt)("--help prints usage and exits 0", () => {
    const result = spawnSync("node", [BIN_PATH, "--help"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage");
  });

  it.skipIf(!binBuilt)("exits 1 for nonexistent file argument", () => {
    const result = spawnSync("node", [BIN_PATH, "/nonexistent/path.sarif"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("sarif-viewer-tui");
  });

  it.skipIf(!binBuilt)("exits 1 for invalid SARIF file (bad JSON)", () => {
    const badPath = join(dir, "bad.sarif");
    writeFileSync(badPath, "{ not valid json");
    const result = spawnSync("node", [BIN_PATH, badPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("sarif-viewer-tui");
  });

  it.skipIf(!binBuilt)("exits 1 when no input and stdin is empty", () => {
    // stdin is a pipe with no data — readFileSync(0) returns empty.
    const result = spawnSync("node", [BIN_PATH], {
      encoding: "utf8",
      input: "",
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("sarif-viewer-tui");
  });

  it.skipIf(!binBuilt)("prints findings as text for a file argument without a TTY", () => {
    const sarifPath = join(dir, "valid.sarif");
    writeFileSync(sarifPath, VALID_SARIF_JSON);
    const result = spawnSync("node", [BIN_PATH, sarifPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60000,
    });
    // No TTY — the TUI cannot run, so findings print as plain text and
    // the command exits 0 instead of crashing on Ink raw mode.
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("SARIF findings");
    expect(result.stderr).not.toContain("Raw mode is not supported");
  }, 90000);

  it.skipIf(!binBuilt)("prints findings as text for piped stdin without a TTY", () => {
    const result = spawnSync("node", [BIN_PATH], {
      encoding: "utf8",
      input: VALID_SARIF_JSON,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 60000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("SARIF findings");
    expect(result.stderr).not.toContain("Raw mode is not supported");
  }, 90000);
});
