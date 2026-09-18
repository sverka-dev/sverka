import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { main } from "../index.js";
import {
  makeTempDir,
  cleanupTempDir,
  CaptureWriter,
  initGitRepo,
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
    expect(content).toContain("Project");
    expect(content).toContain("Pipeline");
    expect(content).toContain('"verify"');
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
    expect(content).toContain("Project");
  });

  it("--config with a relative path creates the file under root", async () => {
    const out = new CaptureWriter();
    const code = await main(
      ["init", "--root", dir, "--config", "config/sverka.config.ts"],
      { output: out },
    );
    expect(code).toBe(0);
    const configPath = join(dir, "config", "sverka.config.ts");
    expect(existsSync(configPath)).toBe(true);
  });

  it("--config with an absolute path creates the file at that path", async () => {
    const absDir = await makeTempDir();
    try {
      const absPath = join(absDir, "custom.config.ts");
      const out = new CaptureWriter();
      const code = await main(
        ["init", "--root", dir, "--config", absPath],
        { output: out },
      );
      expect(code).toBe(0);
      expect(existsSync(absPath)).toBe(true);
      expect(existsSync(join(dir, "sverka.config.ts"))).toBe(false);
    } finally {
      await cleanupTempDir(absDir);
    }
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

  it("exits 3 when package.json is malformed", async () => {
    await writeFile(join(dir, "package.json"), "not json", "utf8");
    const out = new CaptureWriter();
    const code = await main(["init", "--root", dir], { output: out });
    expect(code).toBe(3);
    expect(out.stderrText).toContain("package.json");
  });

  it("--detect generates a config from package.json scripts that validates clean", async () => {
    await initGitRepo(dir);
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "fixture",
        packageManager: "npm@11.0.0",
        scripts: {
          typecheck: "echo typecheck-ok",
          lint: "echo lint-ok",
          test: "echo test-ok",
        },
      }),
      "utf8",
    );
    await writeFile(join(dir, "index.ts"), "export const x = 1;\n", "utf8");

    const out = new CaptureWriter();
    const code = await main(["init", "--detect", "--root", dir], { output: out });
    expect(code).toBe(0);
    expect(out.stdoutText).toContain("template: detect");

    const content = await readFile(join(dir, "sverka.config.ts"), "utf8");
    expect(content).toMatch(/new ShellStep\(ci, "typecheck", \{ command: "npm run typecheck" \}\);/);
    expect(content).toMatch(/new ShellStep\(ci, "lint", \{ command: "npm run lint" \}\);/);
    expect(content).toMatch(/new ShellStep\(ci, "test", \{ command: "npm run test" \}\);/);
    expect(content).toContain('roots: ["typecheck", "lint", "test"]');

    // The generated config must load and validate with no warnings.
    const vout = new CaptureWriter();
    const vcode = await main(["validate", "--root", dir], { output: vout });
    expect(vcode).toBe(0);
    expect(vout.stderrText).not.toContain("warning");
  });

  it("--detect works without a git repository", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "fixture",
        scripts: { lint: "echo lint-ok", test: "echo test-ok" },
      }),
      "utf8",
    );

    const out = new CaptureWriter();
    const code = await main(["init", "--detect", "--root", dir], { output: out });
    expect(code).toBe(0);
    expect(out.stdoutText).toContain("template: detect");

    const content = await readFile(join(dir, "sverka.config.ts"), "utf8");
    expect(content).toContain('"lint"');
    expect(content).toContain('"test"');
    expect(content).not.toContain('"typecheck"');
  });

  it("--detect emits steps only for scripts that exist in package.json", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "fixture",
        scripts: { lint: "echo lint-ok", build: "echo build-ok" },
      }),
      "utf8",
    );

    const out = new CaptureWriter();
    const code = await main(["init", "--detect", "--root", dir], { output: out });
    expect(code).toBe(0);

    const content = await readFile(join(dir, "sverka.config.ts"), "utf8");
    expect(content).toContain('"lint"');
    expect(content).toContain('"build"');
    expect(content).not.toContain('"typecheck"');
    expect(content).not.toContain('"test"');
  });

  it("declares an installable @sverka/workflow dep (not bare *)", async () => {
    const out = new CaptureWriter();
    const code = await main(["init", "--root", dir], { output: out });
    expect(code).toBe(0);

    const pkg = JSON.parse(
      await readFile(join(dir, "package.json"), "utf8"),
    ) as { devDependencies?: Record<string, string> };
    const spec = pkg.devDependencies?.["@sverka/workflow"];
    expect(spec).toBeDefined();
    expect(spec).not.toBe("*");
    expect(spec).toMatch(/^(workspace:\*|link:|file:|\^)/);
  });

  it("replaces a malformed non-string @sverka/workflow dep with a usable spec", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "fixture",
        devDependencies: { "@sverka/workflow": 123 },
      }),
      "utf8",
    );

    const out = new CaptureWriter();
    const code = await main(["init", "--root", dir], { output: out });
    expect(code).toBe(0);

    const pkg = JSON.parse(
      await readFile(join(dir, "package.json"), "utf8"),
    ) as { devDependencies?: Record<string, string> };
    const spec = pkg.devDependencies?.["@sverka/workflow"];
    expect(typeof spec).toBe("string");
    expect(spec).toMatch(/^(workspace:\*|link:|file:|\^)/);
  });
});
