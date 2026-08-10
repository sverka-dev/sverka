import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { main } from "../index.js";
import {
  makeTempDir,
  cleanupTempDir,
  CaptureWriter,
  initGitRepo,
} from "./helpers/fixtures.js";

describe("plan command", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
    await initGitRepo(dir);
  });

  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it("prints the plan result in human format", async () => {
    const out = new CaptureWriter();
    const code = await main(["plan", "--root", dir], { output: out });
    expect(code).toBe(0);
    expect(out.stdoutText).toContain("Plan for");
  });

  it("does not execute checks (no execution output)", async () => {
    const out = new CaptureWriter();
    await main(["plan", "--root", dir], { output: out });
    // Plan output should not contain execution verdict/status
    expect(out.stdoutText).not.toContain("verdict:");
    expect(out.stdoutText).not.toContain("Execution:");
  });

  it("--format json prints plan as JSON", async () => {
    const out = new CaptureWriter();
    const code = await main(
      ["plan", "--format", "json", "--root", dir],
      { output: out },
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(out.stdoutText.trim());
    expect(parsed.command).toBe("plan");
    expect(parsed.data.context.root).toBe(dir);
    expect(Array.isArray(parsed.data.operations)).toBe(true);
  });
});
