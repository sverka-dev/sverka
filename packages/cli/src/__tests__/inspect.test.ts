import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { main } from "../index.js";
import {
  makeTempDir,
  cleanupTempDir,
  CaptureWriter,
  initGitRepo,
} from "./helpers/fixtures.js";

describe("inspect command", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
    await initGitRepo(dir);
  });

  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it("prints project context in human format", async () => {
    const out = new CaptureWriter();
    const code = await main(["inspect", "--root", dir], { output: out });
    expect(code).toBe(0);
    expect(out.stdoutText).toContain("Project context");
    expect(out.stdoutText).toContain("commit:");
  });

  it("--format json prints context as JSON", async () => {
    const out = new CaptureWriter();
    const code = await main(["inspect", "--format", "json", "--root", dir], {
      output: out,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(out.stdoutText.trim());
    expect(parsed.command).toBe("inspect");
    expect(parsed.data.root).toBe(dir);
    expect(typeof parsed.data.commit).toBe("string");
    expect(typeof parsed.durationMs).toBe("number");
  });
});
