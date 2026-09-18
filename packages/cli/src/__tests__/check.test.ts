import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { main } from "../index.js";
import {
  makeTempDir,
  cleanupTempDir,
  CaptureWriter,
  initGitRepo,
} from "./helpers/fixtures.js";

interface CheckOutput {
  data: {
    proposed: string[];
    resolved: { id: string; command: string }[];
  };
}

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
    const parsed = JSON.parse(out.stdoutText.trim()) as CheckOutput;
    expect(parsed.data.proposed).toContain("lint");
    expect(parsed.data.proposed).toContain("build");
    expect(parsed.data.proposed).not.toContain("typecheck");
    // pm is detected from lockfiles — the exact prefix varies by env.
    const lint = parsed.data.resolved.find((r) => r.id === "lint");
    expect(lint?.command).toMatch(/run lint$/);
  });

  it("proposes nothing for a project with no detectable checks", async () => {
    const out = new CaptureWriter();
    const code = await main(["check", "--format", "json", "--root", dir], {
      output: out,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(out.stdoutText.trim()) as CheckOutput;
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
    const { proposed } = (JSON.parse(cout.stdoutText.trim()) as CheckOutput)
      .data;
    expect(proposed).toContain("lint");
    expect(proposed).toContain("test");

    // init --detect must emit exactly the same set of step ids.
    const iout = new CaptureWriter();
    const icode = await main(["init", "--detect", "--root", dir], {
      output: iout,
    });
    expect(icode).toBe(0);
    const config = await readFile(join(dir, "sverka.config.ts"), "utf8");
    const stepIds = [...config.matchAll(/new ShellStep\(ci, "([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(stepIds.sort()).toEqual([...proposed].sort());
  });

  it("scopes detection to a nested root — parent ecosystems do not leak", async () => {
    await initGitRepo(dir);
    // Parent: Go project + a package.json lint script.
    await writeFile(join(dir, "go.mod"), "module example.com/x\n", "utf8");
    await writeFile(join(dir, "main.go"), "package main\n", "utf8");
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "parent", scripts: { lint: "echo lint" } }),
      "utf8",
    );
    // Nested project: only its own test script.
    const sub = join(dir, "app");
    await mkdir(sub, { recursive: true });
    await writeFile(
      join(sub, "package.json"),
      JSON.stringify({ name: "app", scripts: { test: "echo test" } }),
      "utf8",
    );

    const out = new CaptureWriter();
    const code = await main(["check", "--format", "json", "--root", sub], {
      output: out,
    });
    expect(code).toBe(0);
    const { proposed, resolved } = (
      JSON.parse(out.stdoutText.trim()) as CheckOutput
    ).data;
    // Steps run with cwd=sub — go vet/test and the parent's lint must not
    // be proposed.
    expect(proposed).toEqual(["test"]);
    expect(resolved.every((r) => !r.command.startsWith("go "))).toBe(true);
  });
});
