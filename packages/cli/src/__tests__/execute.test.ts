import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { main } from "../index.js";
import {
  makeTempDir,
  cleanupTempDir,
  CaptureWriter,
  initGitRepo,
  writefile,
} from "./helpers/fixtures.js";

// Mock the runtime-check so docker appears unavailable.
vi.mock("../internal/runtime-check.js", () => ({
  isBinaryAvailable: vi.fn((binary: string) => binary !== "docker"),
}));

describe("execute / run command", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
    await initGitRepo(dir);
  });

  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  async function writePassingConfig(d: string): Promise<void> {
    await writefile(
      d,
      "sverka.config.ts",
      `import { defineWorkflow, pipeline, task, run } from "@sverka/sdk";
export default defineWorkflow({
  name: "test",
  workflow: pipeline(task("op", run({ command: "true" }))),
});
`,
    );
  }

  async function writeFailingConfig(d: string): Promise<void> {
    await writefile(
      d,
      "sverka.config.ts",
      `import { defineWorkflow, pipeline, task, run } from "@sverka/sdk";
export default defineWorkflow({
  name: "test",
  workflow: pipeline(task("op", run({ command: "false" }))),
});
`,
    );
  }

  it("executes the workflow and prints results", async () => {
    await writePassingConfig(dir);
    const out = new CaptureWriter();
    const code = await main(["execute", "--root", dir], { output: out });
    expect(code).toBe(0);
    expect(out.stdoutText).toContain("Execution:");
    expect(out.stdoutText).toContain("verdict:");
  });

  it("exit code 0 when verdict is pass", async () => {
    await writePassingConfig(dir);
    const out = new CaptureWriter();
    const code = await main(["execute", "--root", dir], { output: out });
    expect(code).toBe(0);
  });

  it("exit code 1 when verdict is fail", async () => {
    await writeFailingConfig(dir);
    const out = new CaptureWriter();
    const code = await main(["execute", "--root", dir], { output: out });
    expect(code).toBe(1);
  });

  it("'run' is an alias for 'execute'", async () => {
    await writePassingConfig(dir);
    const out = new CaptureWriter();
    const code = await main(["run", "--root", dir], { output: out });
    expect(code).toBe(0);
    expect(out.stdoutText).toContain("Execution:");
  });

  it("--executor host selects host executor", async () => {
    await writePassingConfig(dir);
    const out = new CaptureWriter();
    const code = await main(
      ["execute", "--executor", "host", "--root", dir],
      { output: out },
    );
    expect(code).toBe(0);
  });

  it("--format json produces JSON output", async () => {
    await writePassingConfig(dir);
    const out = new CaptureWriter();
    const code = await main(
      ["execute", "--format", "json", "--root", dir],
      { output: out },
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(out.stdoutText.trim());
    expect(parsed.command).toBe("execute");
    expect(parsed.verdict).toBe("pass");
    expect(typeof parsed.data.durationMs).toBe("number");
  });

  it("--only-new filters to new findings (no baseline → all new)", async () => {
    await writePassingConfig(dir);
    const out = new CaptureWriter();
    const code = await main(
      ["execute", "--only-new", "--root", dir],
      { output: out },
    );
    // No baseline path given → onlyNew with no baseline is a no-op in SDK
    expect(code).toBe(0);
  });

  it("--baseline resolves a relative baseline path against --root, not process cwd", async () => {
    await writePassingConfig(dir);
    // Create a baseline at the default path under <dir>.
    await main(["baseline", "create", "--root", dir], {
      output: new CaptureWriter(),
    });
    const out = new CaptureWriter();
    const code = await main(
      ["execute", "--only-new", "--baseline", ".sverka/baseline.json", "--root", dir],
      { output: out },
    );
    // If the relative path were resolved against process cwd, loadBaseline
    // would throw ENOENT and the command would exit 3.
    expect(code).toBe(0);
  });

  it("--format json serializes outcomes as an object, not an empty {}", async () => {
    await writePassingConfig(dir);
    const out = new CaptureWriter();
    const code = await main(
      ["execute", "--format", "json", "--root", dir],
      { output: out },
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(out.stdoutText.trim());
    expect(parsed.command).toBe("execute");
    // outcomes is a Map at runtime; it must be serialized as a populated
    // object, not dropped to {} by JSON.stringify(Map).
    expect(parsed.data.outcomes).toBeDefined();
    expect(typeof parsed.data.outcomes).toBe("object");
    expect(Object.keys(parsed.data.outcomes).length).toBeGreaterThan(0);
  });

  it("--executor docker throws RUNTIME_NOT_AVAILABLE (exit 3) when docker not installed", async () => {
    await writePassingConfig(dir);
    const out = new CaptureWriter();
    const code = await main(
      ["execute", "--executor", "docker", "--root", dir],
      { output: out },
    );
    expect(code).toBe(3);
    expect(out.stderrText).toContain("docker");
  });
});
