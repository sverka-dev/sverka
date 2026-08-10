import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { main } from "../index.js";
import {
  makeTempDir,
  cleanupTempDir,
  CaptureWriter,
  initGitRepo,
  writefile,
} from "./helpers/fixtures.js";

describe("baseline command", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
    await initGitRepo(dir);
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
  });

  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it("create creates a baseline from execution", async () => {
    const out = new CaptureWriter();
    const code = await main(
      ["baseline", "create", "--root", dir],
      { output: out },
    );
    expect(code).toBe(0);
    expect(existsSync(join(dir, ".sverka", "baseline.json"))).toBe(true);
  });

  it("show displays the baseline", async () => {
    await main(["baseline", "create", "--root", dir], {
      output: new CaptureWriter(),
    });
    const out = new CaptureWriter();
    const code = await main(
      ["baseline", "show", "--root", dir],
      { output: out },
    );
    expect(code).toBe(0);
    expect(out.stdoutText).toContain("Baseline:");
    expect(out.stdoutText).toContain("fingerprints:");
  });

  it("update updates the baseline", async () => {
    await main(["baseline", "create", "--root", dir], {
      output: new CaptureWriter(),
    });
    const out = new CaptureWriter();
    const code = await main(
      ["baseline", "update", "--root", dir],
      { output: out },
    );
    expect(code).toBe(0);
    expect(out.stdoutText).toContain("updated");
  });

  it("clear removes the baseline file", async () => {
    await main(["baseline", "create", "--root", dir], {
      output: new CaptureWriter(),
    });
    expect(existsSync(join(dir, ".sverka", "baseline.json"))).toBe(true);
    const out = new CaptureWriter();
    const code = await main(
      ["baseline", "clear", "--root", dir],
      { output: out },
    );
    expect(code).toBe(0);
    expect(existsSync(join(dir, ".sverka", "baseline.json"))).toBe(false);
  });

  it("clear is idempotent when no baseline exists", async () => {
    const out = new CaptureWriter();
    const code = await main(
      ["baseline", "clear", "--root", dir],
      { output: out },
    );
    expect(code).toBe(0);
  });

  it("clear propagates non-ENOENT unlink errors instead of swallowing them", async () => {
    // Make the baseline path a directory: existsSync is true, but unlink throws EISDIR.
    const baselinePath = join(dir, ".sverka", "baseline.json");
    await mkdir(join(dir, ".sverka"), { recursive: true });
    await mkdir(baselinePath);
    expect(existsSync(baselinePath)).toBe(true);
    const out = new CaptureWriter();
    const code = await main(
      ["baseline", "clear", "--root", dir],
      { output: out },
    );
    expect(code).not.toBe(0);
    expect(out.stderrText).toContain("error:");
  });

  it("--baseline specifies a custom baseline path", async () => {
    const customRel = "custom-baseline.json";
    const out = new CaptureWriter();
    const code = await main(
      ["baseline", "create", "--baseline", customRel, "--root", dir],
      { output: out },
    );
    expect(code).toBe(0);
    expect(existsSync(join(dir, customRel))).toBe(true);
  });

  it("unknown subcommand exits with 2", async () => {
    const out = new CaptureWriter();
    const code = await main(
      ["baseline", "frobnicate", "--root", dir],
      { output: out },
    );
    expect(code).toBe(2);
  });
});
