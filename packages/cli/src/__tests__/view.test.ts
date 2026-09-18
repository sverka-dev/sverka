import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { main } from "../index.js";
import {
  makeTempDir,
  cleanupTempDir,
  CaptureWriter,
} from "./helpers/fixtures.js";

const SARIF = JSON.stringify({
  version: "2.1.0",
  runs: [
    {
      tool: { driver: { name: "fixture", rules: [] } },
      results: [],
    },
  ],
});

describe("view command", () => {
  let dir: string;
  let sarifPath: string;

  beforeEach(async () => {
    dir = await makeTempDir();
    sarifPath = join(dir, "report.sarif");
    await writeFile(sarifPath, SARIF, "utf8");
  });

  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it("exits 2 with a readable error instead of crashing Ink when stdin is not a TTY", async () => {
    const out = new CaptureWriter();
    const code = await main(["view", sarifPath, "--format", "tui"], {
      output: out,
    });
    expect(code).toBe(2);
    expect(out.stderrText).toContain("interactive terminal");
    expect(out.stderrText).toContain("--format web");
    expect(out.stderrText).not.toContain("Raw mode is not supported");
  });

  it("--format web writes an HTML report", async () => {
    const outPath = join(dir, "report.html");
    const out = new CaptureWriter();
    const code = await main(
      ["view", sarifPath, "--format", "web", "--output", outPath],
      { output: out },
    );
    expect(code).toBe(0);
    expect(existsSync(outPath)).toBe(true);
    const html = await readFile(outPath, "utf8");
    expect(html).toContain("<");
  });

  it("--format html is accepted as an alias for web", async () => {
    const outPath = join(dir, "report-alias.html");
    const out = new CaptureWriter();
    const code = await main(
      ["view", sarifPath, "--format", "html", "--output", outPath],
      { output: out },
    );
    expect(code).toBe(0);
    expect(existsSync(outPath)).toBe(true);
  });
});
