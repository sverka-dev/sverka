import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { main } from "../index.js";
import {
  makeTempDir,
  cleanupTempDir,
  CaptureWriter,
  writefile,
} from "./helpers/fixtures.js";

const EMPTY_SARIF = JSON.stringify({
  version: "2.1.0",
  runs: [
    {
      tool: { driver: { name: "test" } },
      results: [],
    },
  ],
});

const VALID_CONFIG = `import { Project, Pipeline, ShellStep, Entry } from "@sverka/workflow";
const proj = new Project("myproj");
const pipeline = new Pipeline(proj, "ci");
new ShellStep(pipeline, "build", { command: "echo build" });
new ShellStep(pipeline, "test", { command: "echo test", dependencies: [{ kind: "control", producer: "build" }] });
new Entry(pipeline, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
export default proj;
`;

/** Creates a temp dir before each test and cleans it up after. */
function useTempDir() {
  let dir = "";
  beforeEach(async () => {
    dir = await makeTempDir();
  });
  afterEach(async () => {
    await cleanupTempDir(dir);
  });
  return () => dir;
}

/** Writes a file to the dir, runs main, and returns the exit code and captured output. */
async function runWithFile(
  args: string[],
  dir: string,
  filename: string,
  content: string,
) {
  await writefile(dir, filename, content);
  const out = new CaptureWriter();
  const code = await main(args, { output: out });
  return { code, out };
}

/** Runs main with the given args and asserts the exit code is 2. */
async function runExpectingExit2(args: string[]) {
  const out = new CaptureWriter();
  const code = await main(args, { output: out });
  expect(code).toBe(2);
  return out;
}

describe("graph command", () => {
  const getDir = useTempDir();

  it("prints the graph in text format", async () => {
    const dir = getDir();
    const { code, out } = await runWithFile(
      ["graph", "--root", dir],
      dir,
      "sverka.config.ts",
      VALID_CONFIG,
    );
    expect(code).toBe(0);
    expect(out.stdoutText).toContain("Definition Graph");
    expect(out.stdoutText).toContain("myproj");
    expect(out.stdoutText).toContain("ci/build");
    expect(out.stdoutText).toContain("ci/test");
  });

  it("prints JSON format", async () => {
    const dir = getDir();
    const { code, out } = await runWithFile(
      ["graph", "--root", dir, "--format", "json"],
      dir,
      "sverka.config.ts",
      VALID_CONFIG,
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(out.stdoutText.trim());
    expect(parsed.command).toBe("graph");
    expect(parsed.data.project.id).toBe("myproj");
  });

  it("exits 2 when no config found", async () => {
    await runExpectingExit2(["graph", "--root", getDir()]);
  });
});

describe("compile command", () => {
  const getDir = useTempDir();

  it("compiles to github YAML", async () => {
    const dir = getDir();
    const { code, out } = await runWithFile(
      ["compile", "--target", "github", "--root", dir],
      dir,
      "sverka.config.ts",
      VALID_CONFIG,
    );
    expect(code).toBe(0);
    expect(out.stdoutText).toContain("on:");
    expect(out.stdoutText).toContain("jobs:");
  });

  it("compiles to gitlab YAML", async () => {
    const dir = getDir();
    const { code, out } = await runWithFile(
      ["compile", "--target", "gitlab", "--root", dir],
      dir,
      "sverka.config.ts",
      VALID_CONFIG,
    );
    expect(code).toBe(0);
    expect(out.stdoutText).toContain("stages:");
  });

  it("prints JSON format", async () => {
    const dir = getDir();
    const { code, out } = await runWithFile(
      ["compile", "--target", "github", "--root", dir, "--format", "json"],
      dir,
      "sverka.config.ts",
      VALID_CONFIG,
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(out.stdoutText.trim());
    expect(parsed.command).toBe("compile");
    expect(parsed.data.target).toBe("github");
    expect(typeof parsed.data.yaml).toBe("string");
  });

  it("writes to --output file", async () => {
    const dir = getDir();
    const { code } = await runWithFile(
      [
        "compile",
        "--target",
        "github",
        "--root",
        dir,
        "--output",
        "workflow.yml",
      ],
      dir,
      "sverka.config.ts",
      VALID_CONFIG,
    );
    expect(code).toBe(0);
    const { readFileSync } = await import("node:fs");
    const content = readFileSync(`${dir}/workflow.yml`, "utf8");
    expect(content).toContain("on:");
    expect(content).toContain("jobs:");
  });

  it("writes each artifact to --output-dir (multi-pipeline)", async () => {
    const dir = getDir();
    const { code, out } = await runWithFile(
      ["compile", "--target", "github", "--root", dir, "--output-dir", "gen"],
      dir,
      "sverka.config.ts",
      `import { Project, Pipeline, ShellStep, Entry } from "@sverka/workflow";
const proj = new Project("myproj");
const ci = new Pipeline(proj, "ci");
new ShellStep(ci, "build", { command: "echo build" });
new Entry(ci, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
const rel = new Pipeline(proj, "release");
new ShellStep(rel, "publish", { command: "echo publish" });
new Entry(rel, "on-tag", { trigger: { kind: "manual" }, roots: ["publish"] });
export default proj;
`,
    );
    expect(code).toBe(0);
    const { readFileSync } = await import("node:fs");
    const ci = readFileSync(`${dir}/gen/.github/workflows/ci.yml`, "utf8");
    const rel = readFileSync(
      `${dir}/gen/.github/workflows/release.yml`,
      "utf8",
    );
    expect(ci).toContain("jobs:");
    expect(rel).toContain("jobs:");
    expect(out.stdoutText).toContain("ci.yml");
    expect(out.stdoutText).toContain("release.yml");
  });

  it("rejects --output-dir writes escaping via symlinked dirs", async () => {
    const dir = getDir();
    await writefile(dir, "sverka.config.ts", VALID_CONFIG);
    const {
      mkdirSync,
      symlinkSync,
      existsSync: fsExists,
    } = await import("node:fs");
    mkdirSync(`${dir}/gen`, { recursive: true });
    mkdirSync(`${dir}/escape-target`, { recursive: true });
    symlinkSync(`${dir}/escape-target`, `${dir}/gen/.github`, "dir");
    const out = new CaptureWriter();
    const code = await main(
      ["compile", "--target", "github", "--root", dir, "--output-dir", "gen"],
      { output: out },
    );
    expect(code).toBe(2);
    expect(out.stderrText).toContain("escapes output dir");
    expect(fsExists(`${dir}/escape-target/workflows/ci.yml`)).toBe(false);
  });

  it("exits 2 when --output is given for a multi-pipeline project", async () => {
    const dir = getDir();
    await writefile(
      dir,
      "sverka.config.ts",
      `import { Project, Pipeline, ShellStep, Entry } from "@sverka/workflow";
const proj = new Project("myproj");
const ci = new Pipeline(proj, "ci");
new ShellStep(ci, "build", { command: "echo build" });
new Entry(ci, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
const rel = new Pipeline(proj, "release");
new ShellStep(rel, "publish", { command: "echo publish" });
new Entry(rel, "on-tag", { trigger: { kind: "manual" }, roots: ["publish"] });
export default proj;
`,
    );
    const out = new CaptureWriter();
    const code = await main(
      ["compile", "--target", "github", "--root", dir, "--output", "all.yml"],
      { output: out },
    );
    expect(code).toBe(2);
    expect(out.stderrText).toContain("--output-dir");
  });

  it("exits 2 when --output and --output-dir are combined", async () => {
    const dir = getDir();
    await writefile(dir, "sverka.config.ts", VALID_CONFIG);
    const out = new CaptureWriter();
    const code = await main(
      [
        "compile",
        "--target",
        "github",
        "--root",
        dir,
        "--output",
        "a.yml",
        "--output-dir",
        "gen",
      ],
      { output: out },
    );
    expect(code).toBe(2);
    expect(out.stderrText).toContain("mutually exclusive");
  });

  it("exits 2 when no config found", async () => {
    await runExpectingExit2([
      "compile",
      "--target",
      "github",
      "--root",
      getDir(),
    ]);
  });

  it("exits 2 for invalid target", async () => {
    await runExpectingExit2(["compile", "--target", "bad", "--root", getDir()]);
  });

  it("prints diagnostics to stderr and exits 3 on error-severity findings", async () => {
    // Two OIDC audiences → secrets.oidc.multiAudience → unsupported on github
    // → error diagnostic (stdout must still carry clean YAML).
    const dir = getDir();
    const { code, out } = await runWithFile(
      ["compile", "--target", "github", "--root", dir],
      dir,
      "sverka.config.ts",
      `import { Project, Pipeline, ShellStep, Entry } from "@sverka/workflow";
const proj = new Project("myproj");
const pipeline = new Pipeline(proj, "ci");
new ShellStep(pipeline, "build", {
  command: "echo build",
  identity: { tokens: { a: { audience: "aud-a" }, b: { audience: "aud-b" } } },
});
new Entry(pipeline, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
export default proj;
`,
    );
    expect(code).toBe(3);
    expect(out.stderrText).toContain("secrets.oidc.multiAudience");
    expect(out.stderrText).toContain("[error]");
    expect(out.stdoutText).toContain("jobs:");
  });
});

describe("synth command (delegates to compile)", () => {
  const getDir = useTempDir();

  it("delegates to compile for github", async () => {
    const dir = getDir();
    const { code, out } = await runWithFile(
      ["synth", "--target", "github", "--root", dir],
      dir,
      "sverka.config.ts",
      VALID_CONFIG,
    );
    expect(code).toBe(0);
    expect(out.stdoutText).toContain("on:");
  });

  it("delegates to compile for gitlab", async () => {
    const dir = getDir();
    const { code, out } = await runWithFile(
      ["synth", "--target", "gitlab", "--root", dir],
      dir,
      "sverka.config.ts",
      VALID_CONFIG,
    );
    expect(code).toBe(0);
    expect(out.stdoutText).toContain("stages:");
  });
});

describe("run command", () => {
  const getDir = useTempDir();

  it("executes a valid config and reports success", async () => {
    const dir = getDir();
    const { code, out } = await runWithFile(
      ["run", "--root", dir],
      dir,
      "sverka.config.ts",
      VALID_CONFIG,
    );
    expect(code).toBe(0);
    expect(out.stdoutText).toContain("run completed");
    expect(out.stdoutText).toContain("success");
  });
});

describe("policy command", () => {
  const getDir = useTempDir();

  it("requires --findings", async () => {
    await runExpectingExit2(["policy", "--root", getDir()]);
  });

  it("passes with empty findings", async () => {
    const dir = getDir();
    const { code, out } = await runWithFile(
      ["policy", "--root", dir, "--findings", "findings.sarif"],
      dir,
      "findings.sarif",
      EMPTY_SARIF,
    );
    expect(code).toBe(0);
    expect(out.stdoutText).toContain("pass");
  });

  it("prints JSON format", async () => {
    const dir = getDir();
    const { code, out } = await runWithFile(
      [
        "policy",
        "--root",
        dir,
        "--findings",
        "findings.sarif",
        "--format",
        "json",
      ],
      dir,
      "findings.sarif",
      EMPTY_SARIF,
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(out.stdoutText.trim());
    expect(parsed.command).toBe("policy");
    expect(parsed.data.verdict).toBe("pass");
  });
});

describe("view command", () => {
  const getDir = useTempDir();

  it("writes an HTML report with -o alias (documented flag)", async () => {
    const dir = getDir();
    await writefile(dir, "f.sarif", EMPTY_SARIF);
    const out = new CaptureWriter();
    const outPath = join(dir, "report.html");
    const code = await main(
      ["view", join(dir, "f.sarif"), "-f", "web", "-o", outPath, "--root", dir],
      { output: out },
    );
    expect(code).toBe(0);
    expect(existsSync(outPath)).toBe(true);
  });
});
