import { describe, it, expect, beforeEach, afterEach } from "vitest";
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

  it("prints the graph in human format", async () => {
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
      ["compile", "--target", "github", "--root", dir, "--output", "workflow.yml"],
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

  it("exits 2 when no config found", async () => {
    await runExpectingExit2(["compile", "--target", "github", "--root", getDir()]);
  });

  it("exits 2 for invalid target", async () => {
    await runExpectingExit2(["compile", "--target", "bad", "--root", getDir()]);
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
    expect(out.stdoutText).toContain("Run completed: success");
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
      ["policy", "--root", dir, "--findings", "findings.sarif", "--format", "json"],
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
