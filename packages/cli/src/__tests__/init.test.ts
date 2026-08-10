import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { main } from "../index.js";
import {
  makeTempDir,
  cleanupTempDir,
  CaptureWriter,
} from "./helpers/fixtures.js";

describe("init command", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it("creates a sverka.config.ts with default minimal content", async () => {
    const out = new CaptureWriter();
    const code = await main(["init", "--root", dir], { output: out });
    expect(code).toBe(0);
    const configPath = join(dir, "sverka.config.ts");
    expect(existsSync(configPath)).toBe(true);
    const content = await readFile(configPath, "utf8");
    expect(content).toContain("defineWorkflow");
    expect(content).toContain("pipeline");
    expect(content).toContain('name: "verify"');
  });

  it("fails with CONFIG_EXISTS (exit 2) when config exists without --force", async () => {
    const out = new CaptureWriter();
    // First init creates the config
    await main(["init", "--root", dir], { output: out });
    // Second init without --force
    const out2 = new CaptureWriter();
    const code = await main(["init", "--root", dir], { output: out2 });
    expect(code).toBe(2);
    expect(out2.stderrText).toContain("already exists");
  });

  it("--force overwrites an existing config", async () => {
    const out = new CaptureWriter();
    await main(["init", "--root", dir], { output: out });
    const out2 = new CaptureWriter();
    const code = await main(["init", "--root", dir, "--force"], {
      output: out2,
    });
    expect(code).toBe(0);
    expect(existsSync(join(dir, "sverka.config.ts"))).toBe(true);
  });

  it("--template minimal produces minimal config", async () => {
    const out = new CaptureWriter();
    const code = await main(
      ["init", "--root", dir, "--template", "minimal"],
      { output: out },
    );
    expect(code).toBe(0);
    const content = await readFile(join(dir, "sverka.config.ts"), "utf8");
    expect(content).toContain("lint");
    expect(content).toContain("typecheck");
    expect(content).toContain("test");
  });

  it("--template full produces a fuller config", async () => {
    const out = new CaptureWriter();
    const code = await main(
      ["init", "--root", dir, "--template", "full"],
      { output: out },
    );
    expect(code).toBe(0);
    const content = await readFile(join(dir, "sverka.config.ts"), "utf8");
    expect(content).toContain("defineWorkflow");
  });

  it("--format json includes a numeric durationMs (not hardcoded 0)", async () => {
    const out = new CaptureWriter();
    const code = await main(
      ["init", "--format", "json", "--root", dir],
      { output: out },
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(out.stdoutText.trim());
    expect(parsed.command).toBe("init");
    expect(typeof parsed.durationMs).toBe("number");
    expect(parsed.durationMs).toBeGreaterThanOrEqual(0);
  });
});
