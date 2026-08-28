import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { main, ExitCode } from "../index.js";
import {
  makeTempDir,
  cleanupTempDir,
  CaptureWriter,
  writefile,
} from "./helpers/fixtures.js";

describe("main — exit codes", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });
  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it("returns 0 on success (init)", async () => {
    const out = new CaptureWriter();
    const code = await main(["init", "--root", dir], { output: out });
    expect(code).toBe(ExitCode.Success);
  });

  it("returns 2 for unknown command", async () => {
    const out = new CaptureWriter();
    const code = await main(["frobnicate", "--root", dir], { output: out });
    expect(code).toBe(ExitCode.UsageError);
    expect(out.stderrText.length).toBeGreaterThan(0);
  });

  it("returns 2 when no command given", async () => {
    const out = new CaptureWriter();
    const code = await main(["--root", dir], { output: out });
    expect(code).toBe(ExitCode.UsageError);
  });

  it("returns 2 for invalid flag value (--format bad)", async () => {
    const out = new CaptureWriter();
    const code = await main(["init", "--format", "bad", "--root", dir], {
      output: out,
    });
    expect(code).toBe(ExitCode.UsageError);
  });

  it("returns 3 for runtime error (validate with missing config path)", async () => {
    // validate with --config pointing at a non-existent file → CONFIG_NOT_FOUND
    // is mapped to exit 2 (missing arg). To get exit 3, point at a file that
    // exists but is not valid JS/TS (CONFIG_LOAD_FAILED).
    const badPath = join(dir, "sverka.config.ts");
    await writefile(dir, "sverka.config.ts", "this is not valid typescript {{{");
    const out = new CaptureWriter();
    const code = await main(["validate", "--config", badPath, "--root", dir], {
      output: out,
    });
    expect(code).toBe(ExitCode.RuntimeError);
  });
});

describe("main — global flags", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });
  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it("--format json produces JSON output on stdout", async () => {
    const out = new CaptureWriter();
    const code = await main(
      ["init", "--format", "json", "--root", dir],
      { output: out },
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(out.stdoutText.trim());
    expect(parsed.command).toBe("init");
    expect(parsed.data.path).toBe(join(dir, "sverka.config.ts"));
  });

  it("--format human produces human-readable output", async () => {
    const out = new CaptureWriter();
    await main(["init", "--root", dir], { output: out });
    expect(out.stdoutText).toContain("Created");
    // Not valid JSON (has trailing text)
    expect(() => JSON.parse(out.stdoutText.trim())).toThrow();
  });

  it("--quiet suppresses non-error stdout (human format)", async () => {
    const out = new CaptureWriter();
    const code = await main(["init", "--quiet", "--root", dir], {
      output: out,
    });
    expect(code).toBe(0);
    expect(out.stdoutText).toBe("");
    // File was still created
    expect(existsSync(join(dir, "sverka.config.ts"))).toBe(true);
  });

  it("--root changes the working directory", async () => {
    const out = new CaptureWriter();
    await main(["init", "--root", dir], { output: out });
    const content = readFileSync(join(dir, "sverka.config.ts"), "utf8");
    expect(content).toContain("Project");
  });

  it("--verbose adds debug output to stderr", async () => {
    const out = new CaptureWriter();
    const code = await main(["init", "--verbose", "--root", dir], {
      output: out,
    });
    expect(code).toBe(0);
    // FlagAwareWriter routes debug() to errorLine() when verbose
    expect(out.stderrText.length).toBeGreaterThan(0);
  });

  it("--config specifies a custom config path (validate)", async () => {
    // Create a valid config at a non-default location
    const customPath = join(dir, "custom.config.ts");
    await writefile(
      dir,
      "custom.config.ts",
      `import { Project, Pipeline, ShellStep, Entry } from "@sverka/workflow";
const proj = new Project("myproj");
const pipeline = new Pipeline(proj, "ci");
new ShellStep(pipeline, "build", { command: "echo build" });
new Entry(pipeline, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
export default proj;
`,
    );
    const out = new CaptureWriter();
    const code = await main(
      ["validate", "--config", customPath, "--root", dir],
      { output: out },
    );
    expect(code).toBe(0);
    expect(out.stdoutText).toContain("valid");
  });
});

describe("main — error handling", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });
  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it("error messages go to stderr, not stdout", async () => {
    const out = new CaptureWriter();
    await main(["frobnicate", "--root", dir], { output: out });
    expect(out.stderrText.length).toBeGreaterThan(0);
    expect(out.stdoutText).toBe("");
  });

  it("SDK errors are wrapped and exit 3", async () => {
    // validate on a syntactically broken config → CONFIG_LOAD_FAILED → exit 3
    const badPath = join(dir, "sverka.config.ts");
    await writefile(dir, "sverka.config.ts", "syntax error {{{");
    const out = new CaptureWriter();
    const code = await main(["validate", "--config", badPath, "--root", dir], {
      output: out,
    });
    expect(code).toBe(3);
    expect(out.stderrText.length).toBeGreaterThan(0);
  });

  it("missing config file for validate exits 2", async () => {
    const out = new CaptureWriter();
    const code = await main(
      ["validate", "--config", join(dir, "nope.ts"), "--root", dir],
      { output: out },
    );
    expect(code).toBe(2);
  });
});
