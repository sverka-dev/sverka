import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { main } from "../index.js";
import {
  makeTempDir,
  cleanupTempDir,
  CaptureWriter,
  writefile,
} from "./helpers/fixtures.js";

const VALID_CONFIG = `import { Project, Pipeline, ShellStep, Entry } from "@sverka/constructs";
const proj = new Project("myproj");
const pipeline = new Pipeline(proj, "ci");
new ShellStep(pipeline, "build", { command: "echo build" });
new Entry(pipeline, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
export default proj;
`;

describe("validate command", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it("valid config exits with 0", async () => {
    await writefile(dir, "sverka.config.ts", VALID_CONFIG);
    const out = new CaptureWriter();
    const code = await main(["validate", "--root", dir], { output: out });
    expect(code).toBe(0);
    expect(out.stdoutText).toContain("valid");
  });

  it("invalid config exits with 3", async () => {
    await writefile(
      dir,
      "sverka.config.ts",
      `export default { not: "a project" };
`,
    );
    const out = new CaptureWriter();
    const code = await main(["validate", "--root", dir], { output: out });
    expect(code).toBe(3);
  });

  it("missing config exits with 2", async () => {
    const out = new CaptureWriter();
    const code = await main(["validate", "--root", dir], { output: out });
    expect(code).toBe(2);
  });

  it("prints JSON format", async () => {
    await writefile(dir, "sverka.config.ts", VALID_CONFIG);
    const out = new CaptureWriter();
    const code = await main(["validate", "--root", dir, "--format", "json"], { output: out });
    expect(code).toBe(0);
    const parsed = JSON.parse(out.stdoutText.trim());
    expect(parsed.command).toBe("validate");
    expect(parsed.data.valid).toBe(true);
  });
});
