// Spec 53 — zero-config `sverka run`: with no sverka.config.* on disk the
// command bootstraps the detected checks into the implicit `default`
// pipeline (one host ShellStep per check under a `run` entry). Zero
// detections exit 2 pointing at `sverka init`.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "../index.js";
import {
  makeTempDir,
  cleanupTempDir,
  CaptureWriter,
  writefile,
} from "./helpers/fixtures.js";

const PKG = JSON.stringify({
  name: "implicit-demo",
  packageManager: "bun@1.2.0",
  scripts: {
    lint: "echo lint-ok",
    test: "echo test-ok",
  },
});

function useTempDir() {
  let dir: string;
  beforeEach(async () => {
    dir = await makeTempDir("sverka-implicit-");
  });
  afterEach(async () => {
    await cleanupTempDir(dir);
  });
  return () => dir;
}

describe("run command — implicit zero-config pipeline (spec 53)", () => {
  const getDir = useTempDir();

  it("runs detected package.json scripts when no config exists", async () => {
    const dir = getDir();
    await writefile(dir, "package.json", PKG);
    const out = new CaptureWriter();
    const code = await main(["run", "--root", dir, "--format", "text"], {
      output: out,
    });
    expect(code).toBe(0);
    // Implicit pipeline: steps are <pipeline>/<checkId> under "default".
    expect(out.stdoutText).toContain("default/lint");
    expect(out.stdoutText).toContain("default/test");
    // Steps actually executed the scripts (captured stdout tail).
    expect(out.stdoutText).toContain("lint-ok");
    expect(out.stdoutText).toContain("test-ok");
    // stderr carries the detection notice — stdout stays clean.
    expect(out.stderrText).toContain("detected");
    // Human tail: findings summary, then the report line (spec order).
    const lines = out.stdoutText.trimEnd().split("\n");
    expect(lines.at(-2)).toMatch(/^\s*findings: \d+$/);
    const tail = lines.at(-1) ?? "";
    const match = tail.match(/^\s*report: (.+report\.html)\s+\(/);
    if (match === null || match[1] === undefined) {
      throw new Error(`tail line should point at report.html, got: ${tail}`);
    }
    expect(existsSync(match[1])).toBe(true);
  });

  it("--format json marks the run as detected and stays pure JSON", async () => {
    const dir = getDir();
    await writefile(dir, "package.json", PKG);
    const out = new CaptureWriter();
    const code = await main(["run", "--root", dir, "--format", "json"], {
      output: out,
    });
    expect(code).toBe(0);
    const payload = JSON.parse(out.stdoutText.trim());
    expect(payload.command).toBe("run");
    expect(payload.data.detected).toEqual(
      expect.arrayContaining(["lint", "test"]),
    );
    const stepIds = payload.data.steps.map((s: { stepId: string }) => s.stepId);
    expect(stepIds).toEqual(
      expect.arrayContaining(["default/lint", "default/test"]),
    );
    // report.json mirrors the detected marker (sverka.run/v1, append-only).
    const report = JSON.parse(
      readFileSync(payload.data.report.json, "utf-8"),
    ) as { data: { detected?: string[] } };
    expect(report.data.detected).toEqual(
      expect.arrayContaining(["lint", "test"]),
    );
  });

  it("report.json has no detected field for config-based runs", async () => {
    const dir = getDir();
    await writefile(
      dir,
      "sverka.config.ts",
      `import { Project, Pipeline, ShellStep, Entry } from "@sverka/workflow";
const proj = new Project("myproj");
const pipeline = new Pipeline(proj, "ci");
new ShellStep(pipeline, "build", { command: "echo build" });
new Entry(pipeline, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
export default proj;
`,
    );
    const out = new CaptureWriter();
    const code = await main(["run", "--root", dir, "--format", "json"], {
      output: out,
    });
    expect(code).toBe(0);
    const payload = JSON.parse(out.stdoutText.trim());
    expect(payload.data.detected).toBeUndefined();
    const report = JSON.parse(
      readFileSync(payload.data.report.json, "utf-8"),
    ) as { data: { detected?: string[] } };
    expect(report.data.detected).toBeUndefined();
  });

  it("exits 2 pointing at sverka init when nothing is detectable", async () => {
    const dir = getDir();
    const out = new CaptureWriter();
    const code = await main(["run", "--root", dir, "--format", "text"], {
      output: out,
    });
    expect(code).toBe(2);
    expect(out.stderrText).toContain("sverka init");
  });

  it("does not bootstrap when --config is explicit (missing file stays an error)", async () => {
    const dir = getDir();
    await writefile(dir, "package.json", PKG);
    const out = new CaptureWriter();
    const code = await main(
      ["run", "--root", dir, "--config", "missing.config.ts"],
      { output: out },
    );
    expect(code).toBe(2);
    expect(out.stderrText).not.toContain("detected checks");
  });

  it("--report relocates the per-run report.html", async () => {
    const dir = getDir();
    await writefile(dir, "package.json", PKG);
    const out = new CaptureWriter();
    const code = await main(
      ["run", "--root", dir, "--format", "text", "--report", "custom/run.html"],
      { output: out },
    );
    expect(code).toBe(0);
    const relocated = join(dir, "custom", "run.html");
    expect(existsSync(relocated)).toBe(true);
    // Tail points at the relocated file (no `sverka view` hint — view only
    // resolves the default .sverka/runs/<latest>/report.html path).
    const tail = out.stdoutText.trimEnd().split("\n").at(-1) ?? "";
    expect(tail).toContain(`report: ${relocated}`);
    // report.json still lands on the spec path.
    const runsDir = join(dir, ".sverka", "runs");
    const runIds = readdirSync(runsDir).filter((d) =>
      existsSync(join(runsDir, d, "report.json")),
    );
    expect(runIds.length).toBeGreaterThan(0);
  });
});
