import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "../index.js";
import {
  makeTempDir,
  cleanupTempDir,
  CaptureWriter,
  initGitRepo,
  writefile,
} from "./helpers/fixtures.js";

const CONFIG = [
  'import { defineWorkflow, pipeline, task, run } from "@sverka/sdk";',
  "",
  "export default defineWorkflow({",
  '  name: "verify",',
  "  workflow: pipeline(",
  '    task("lint", run({ command: "bun", args: ["run", "lint"] })),',
  '    task("test", run({ command: "bun", args: ["run", "test"] })),',
  "  ),",
  "});",
  "",
].join("\n");

describe("compile command", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
    await initGitRepo(dir);
    await writefile(dir, "sverka.config.ts", CONFIG);
  });

  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it("compiles to GitHub Actions YAML", async () => {
    const out = new CaptureWriter();
    const code = await main(
      ["compile", "--target", "github", "--root", dir],
      { output: out },
    );
    expect(code).toBe(0);
    expect(out.stdoutText).toContain("name: Sverka");
    expect(out.stdoutText).toContain("runs-on: ubuntu-latest");
    expect(out.stdoutText).toContain("sverka execute");
  });

  it("compiles to GitLab CI YAML", async () => {
    const out = new CaptureWriter();
    const code = await main(
      ["compile", "--target", "gitlab", "--root", dir],
      { output: out },
    );
    expect(code).toBe(0);
    expect(out.stdoutText).toContain("stages:");
    expect(out.stdoutText).toContain("- verify");
    expect(out.stdoutText).toContain("image: oven/bun:latest");
    expect(out.stdoutText).toContain("sverka execute");
  });

  it("writes compiled YAML to --output", async () => {
    const out = new CaptureWriter();
    const outPath = join(dir, ".github", "workflows", "sverka.yml");
    const code = await main(
      [
        "compile",
        "--target",
        "github",
        "--root",
        dir,
        "--output",
        ".github/workflows/sverka.yml",
      ],
      { output: out },
    );
    expect(code).toBe(0);
    expect(existsSync(outPath)).toBe(true);
    const written = readFileSync(outPath, "utf8");
    expect(written).toContain("name: Sverka");
    expect(out.stdoutText).toContain("Compiled github workflow to");
  });

  it("fails with usage error for unsupported target", async () => {
    const out = new CaptureWriter();
    const code = await main(
      ["compile", "--target", "azure", "--root", dir],
      { output: out },
    );
    expect(code).toBe(2);
  });
});
