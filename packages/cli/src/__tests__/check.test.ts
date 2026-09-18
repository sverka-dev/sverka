import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { main } from "../index.js";
import {
  makeTempDir,
  cleanupTempDir,
  CaptureWriter,
  initGitRepo,
} from "./helpers/fixtures.js";

describe("check command", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it("proposes package.json script checks without a lockfile or packageManager field", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "fixture",
        scripts: { lint: "echo lint-ok", build: "echo build-ok" },
      }),
      "utf8",
    );

    const out = new CaptureWriter();
    const code = await main(["check", "--format", "json", "--root", dir], {
      output: out,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(out.stdoutText.trim());
    expect(parsed.data.proposed).toContain("lint");
    expect(parsed.data.proposed).toContain("build");
    expect(parsed.data.proposed).not.toContain("typecheck");
    // pm is detected from lockfiles — the exact prefix varies by env.
    const lint = parsed.data.resolved.find(
      (r: { id: string }) => r.id === "lint",
    );
    expect(lint?.command).toMatch(/run lint$/);
  });

  it("proposes nothing for a project with no detectable checks", async () => {
    const out = new CaptureWriter();
    const code = await main(["check", "--format", "json", "--root", dir], {
      output: out,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(out.stdoutText.trim());
    expect(parsed.data.proposed).toEqual([]);
  });

  it("agrees with init --detect on which checks exist", async () => {
    await initGitRepo(dir);
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "fixture",
        packageManager: "npm@11.0.0",
        scripts: { lint: "echo lint-ok", test: "echo test-ok" },
      }),
      "utf8",
    );

    const cout = new CaptureWriter();
    const ccode = await main(["check", "--format", "json", "--root", dir], {
      output: cout,
    });
    expect(ccode).toBe(0);
    const proposed = JSON.parse(cout.stdoutText.trim()).data
      .proposed as string[];
    expect(proposed).toContain("lint");
    expect(proposed).toContain("test");
  });
});
