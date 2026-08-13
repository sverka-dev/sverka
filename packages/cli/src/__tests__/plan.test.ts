import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { main } from "../index.js";
import {
  makeTempDir,
  cleanupTempDir,
  CaptureWriter,
  writefile,
} from "./helpers/fixtures.js";

const VALID_CONFIG = `import { Project, Pipeline, ShellStep, Entry } from "@sverka/cdk";
const proj = new Project("myproj");
const pipeline = new Pipeline(proj, "ci");
new ShellStep(pipeline, "build", { command: "echo build" });
new Entry(pipeline, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
export default proj;
`;

describe("plan command", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it("prints the run plan in human format", async () => {
    await writefile(dir, "sverka.config.ts", VALID_CONFIG);
    const out = new CaptureWriter();
    const code = await main(["plan", "--root", dir], { output: out });
    expect(code).toBe(0);
    expect(out.stdoutText).toContain("Run Plan");
    expect(out.stdoutText).toContain("ci/build");
  });

  it("prints JSON format", async () => {
    await writefile(dir, "sverka.config.ts", VALID_CONFIG);
    const out = new CaptureWriter();
    const code = await main(["plan", "--root", dir, "--format", "json"], { output: out });
    expect(code).toBe(0);
    const parsed = JSON.parse(out.stdoutText.trim());
    expect(parsed.command).toBe("plan");
    expect(parsed.data.steps).toContain("ci/build");
  });

  it("exits 2 when no config found", async () => {
    const out = new CaptureWriter();
    const code = await main(["plan", "--root", dir], { output: out });
    expect(code).toBe(2);
  });

  it("accepts --entry flag", async () => {
    await writefile(dir, "sverka.config.ts", VALID_CONFIG);
    const out = new CaptureWriter();
    const code = await main(["plan", "--root", dir, "--entry", "ci/on-push"], { output: out });
    expect(code).toBe(0);
    expect(out.stdoutText).toContain("ci/on-push");
  });

  it("exits 2 for unknown --entry", async () => {
    await writefile(dir, "sverka.config.ts", VALID_CONFIG);
    const out = new CaptureWriter();
    const code = await main(["plan", "--root", dir, "--entry", "missing"], { output: out });
    expect(code).toBe(2);
    expect(out.stderrText).toContain("missing");
  });
});
