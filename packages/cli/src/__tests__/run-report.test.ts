// Spec 53 — run report artifacts: report.json + report.html land under
// .sverka/runs/<runId>/, the human tail points at the HTML file, and the
// sverka.run/v1 JSON payload gains a `report` field (append-only).

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

const VALID_CONFIG = `import { Project, Pipeline, ShellStep, Entry } from "@sverka/workflow";
const proj = new Project("myproj");
const pipeline = new Pipeline(proj, "ci");
new ShellStep(pipeline, "build", { command: "echo build" });
new Entry(pipeline, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
export default proj;
`;

function useTempDir() {
  let dir: string;
  beforeEach(async () => {
    dir = await makeTempDir("sverka-run-report-");
  });
  afterEach(async () => {
    await cleanupTempDir(dir);
  });
  return () => dir;
}

describe("run command — per-run report artifacts (spec 53)", () => {
  const getDir = useTempDir();

  it("human output ends with a report: line pointing at an existing file", async () => {
    const dir = getDir();
    await writefile(dir, "sverka.config.ts", VALID_CONFIG);
    const out = new CaptureWriter();
    const code = await main(["run", "--root", dir, "--format", "text"], {
      output: out,
    });
    expect(code).toBe(0);

    const tail = out.stdoutText.trimEnd().split("\n").pop() ?? "";
    // This fixture's HTML write must succeed — require report.html so a
    // silent fallback to report.json can't pass.
    const match = tail.match(/^\s*report: (.+report\.html)$/);
    if (match === null || match[1] === undefined) {
      throw new Error(
        `tail line should be 'report: <…report.html>', got: ${tail}`,
      );
    }
    expect(existsSync(match[1])).toBe(true);
  });

  it("writes report.json + report.html under .sverka/runs/<runId>/", async () => {
    const dir = getDir();
    await writefile(dir, "sverka.config.ts", VALID_CONFIG);
    const out = new CaptureWriter();
    const code = await main(["run", "--root", dir, "--format", "text"], {
      output: out,
    });
    expect(code).toBe(0);

    const runsDir = join(dir, ".sverka", "runs");
    if (!existsSync(runsDir)) {
      throw new Error(`expected ${runsDir} to exist after a run`);
    }
    const runIds = readdirSync(runsDir).filter((d) =>
      existsSync(join(runsDir, d, "report.json")),
    );
    const runId = runIds[0];
    if (runId === undefined) {
      throw new Error(`no run directories with report.json in ${runsDir}`);
    }
    const report = JSON.parse(
      readFileSync(join(runsDir, runId, "report.json"), "utf-8"),
    );
    expect(report.schema).toBe("sverka.run/v1");
    expect(report.data.status).toBe("success");
    expect(existsSync(join(runsDir, runId, "report.html"))).toBe(true);
  });

  it("--format json carries data.report paths (sverka.run/v1 field set)", async () => {
    const dir = getDir();
    await writefile(dir, "sverka.config.ts", VALID_CONFIG);
    const out = new CaptureWriter();
    const code = await main(["run", "--root", dir, "--format", "json"], {
      output: out,
    });
    expect(code).toBe(0);

    const payload = JSON.parse(out.stdoutText.trim());
    // Append-only contract: required fields exist; new fields must not
    // break this assertion.
    expect(payload).toMatchObject({
      command: "run",
      data: {
        planId: expect.any(String),
        status: "success",
        steps: expect.any(Array),
        report: {
          html: expect.any(String),
          json: expect.any(String),
        },
      },
      durationMs: expect.any(Number),
    });
    expect(existsSync(payload.data.report.html)).toBe(true);
    expect(existsSync(payload.data.report.json)).toBe(true);
  });
});
