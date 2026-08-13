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

const VALID_CONFIG = `import { Project, Pipeline, ShellStep, Entry } from "@sverka/constructs";
const proj = new Project("myproj");
const pipeline = new Pipeline(proj, "ci");
new ShellStep(pipeline, "build", { command: "echo build" });
new ShellStep(pipeline, "test", { command: "echo test", dependencies: [{ kind: "control", producer: "build" }] });
new Entry(pipeline, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
export default proj;
`;

describe("graph command", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it("prints the graph in human format", async () => {
    await writefile(dir, "sverka.config.ts", VALID_CONFIG);
    const out = new CaptureWriter();
    const code = await main(["graph", "--root", dir], { output: out });
    expect(code).toBe(0);
    expect(out.stdoutText).toContain("Definition Graph");
    expect(out.stdoutText).toContain("myproj");
    expect(out.stdoutText).toContain("ci/build");
    expect(out.stdoutText).toContain("ci/test");
  });

  it("prints JSON format", async () => {
    await writefile(dir, "sverka.config.ts", VALID_CONFIG);
    const out = new CaptureWriter();
    const code = await main(["graph", "--root", dir, "--format", "json"], { output: out });
    expect(code).toBe(0);
    const parsed = JSON.parse(out.stdoutText.trim());
    expect(parsed.command).toBe("graph");
    expect(parsed.data.project.id).toBe("myproj");
  });

  it("exits 2 when no config found", async () => {
    const out = new CaptureWriter();
    const code = await main(["graph", "--root", dir], { output: out });
    expect(code).toBe(2);
  });
});

describe("synth command (stub)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it("exits 2 with stub message for github", async () => {
    const out = new CaptureWriter();
    const code = await main(["synth", "--target", "github", "--root", dir], { output: out });
    expect(code).toBe(2);
    expect(out.stderrText).toContain("not yet implemented");
  });

  it("exits 2 with stub message for gitlab", async () => {
    const out = new CaptureWriter();
    const code = await main(["synth", "--target", "gitlab", "--root", dir], { output: out });
    expect(code).toBe(2);
  });

  it("prints JSON format before erroring", async () => {
    const out = new CaptureWriter();
    const code = await main(["synth", "--target", "github", "--root", dir, "--format", "json"], { output: out });
    expect(code).toBe(2);
    const parsed = JSON.parse(out.stdoutText.trim());
    expect(parsed.data.implemented).toBe(false);
  });
});

describe("run command", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it("executes a valid config and reports success", async () => {
    await writefile(dir, "sverka.config.ts", VALID_CONFIG);
    const out = new CaptureWriter();
    const code = await main(["run", "--root", dir], { output: out });
    expect(code).toBe(0);
    expect(out.stdoutText).toContain("Run completed: success");
  });

});

describe("policy command", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it("requires --findings", async () => {
    const out = new CaptureWriter();
    const code = await main(["policy", "--root", dir], { output: out });
    expect(code).toBe(2);
  });

  it("passes with empty findings", async () => {
    await writefile(dir, "findings.sarif", EMPTY_SARIF);
    const out = new CaptureWriter();
    const code = await main(
      ["policy", "--root", dir, "--findings", "findings.sarif"],
      { output: out },
    );
    expect(code).toBe(0);
    expect(out.stdoutText).toContain("pass");
  });

  it("prints JSON format", async () => {
    await writefile(dir, "findings.sarif", EMPTY_SARIF);
    const out = new CaptureWriter();
    const code = await main(
      ["policy", "--root", dir, "--findings", "findings.sarif", "--format", "json"],
      { output: out },
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(out.stdoutText.trim());
    expect(parsed.command).toBe("policy");
    expect(parsed.data.verdict).toBe("pass");
  });
});
