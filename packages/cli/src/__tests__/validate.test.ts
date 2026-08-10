import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { main } from "../index.js";
import {
  makeTempDir,
  cleanupTempDir,
  CaptureWriter,
  initGitRepo,
  writefile,
} from "./helpers/fixtures.js";

describe("validate command", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
    await initGitRepo(dir);
  });

  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it("valid config exits with 0", async () => {
    await writefile(
      dir,
      "sverka.config.ts",
      `import { defineWorkflow, pipeline, task, run } from "@sverka/sdk";
export default defineWorkflow({
  name: "test",
  workflow: pipeline(task("op", run({ command: "true" }))),
});
`,
    );
    const out = new CaptureWriter();
    const code = await main(["validate", "--root", dir], { output: out });
    expect(code).toBe(0);
    expect(out.stdoutText).toContain("valid");
  });

  it("invalid config exits with 2 and reports errors", async () => {
    await writefile(
      dir,
      "sverka.config.ts",
      `export default { not: "a workflow" };
`,
    );
    const out = new CaptureWriter();
    const code = await main(["validate", "--root", dir], { output: out });
    expect(code).toBe(2);
    expect(out.stderrText.length).toBeGreaterThan(0);
  });

  it("missing config file exits with 2", async () => {
    const out = new CaptureWriter();
    const code = await main(
      ["validate", "--config", join(dir, "nope.ts"), "--root", dir],
      { output: out },
    );
    expect(code).toBe(2);
  });

  it("--config resolves a relative config path against --root, not process cwd", async () => {
    await writefile(
      dir,
      "rel-config.ts",
      `import { defineWorkflow, pipeline, task, run } from "@sverka/sdk";
export default defineWorkflow({
  name: "test",
  workflow: pipeline(task("op", run({ command: "true" }))),
});
`,
    );
    const out = new CaptureWriter();
    const code = await main(
      ["validate", "--config", "rel-config.ts", "--root", dir],
      { output: out },
    );
    // If the relative path were resolved against process cwd, loadWorkflow
    // would throw CONFIG_NOT_FOUND and the command would exit 2.
    expect(code).toBe(0);
    expect(out.stdoutText).toContain("valid");
  });

  it("--format json on valid config", async () => {
    await writefile(
      dir,
      "sverka.config.ts",
      `import { defineWorkflow, pipeline, task, run } from "@sverka/sdk";
export default defineWorkflow({
  name: "test",
  workflow: pipeline(task("op", run({ command: "true" }))),
});
`,
    );
    const out = new CaptureWriter();
    const code = await main(["validate", "--format", "json", "--root", dir], {
      output: out,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(out.stdoutText.trim());
    expect(parsed.command).toBe("validate");
    expect(parsed.data.valid).toBe(true);
  });
});
