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

const SARIF_WITH_FINDING = JSON.stringify({
  version: "2.1.0",
  runs: [
    {
      tool: { driver: { name: "test", rules: [{ id: "test-rule" }] } },
      results: [
        {
          ruleId: "test-rule",
          level: "warning",
          message: { text: "test finding" },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: "src/a.ts" },
                region: { startLine: 1 },
              },
            },
          ],
        },
      ],
    },
  ],
});

/** Same ci/build step as VALID_CONFIG but exporting SARIF via fromStdout —
 *  both configs write <artifactDir>/<runId>/ci/build/results.sarif. */
const SARIF_CONFIG = `import { Project, Pipeline, ShellStep, Entry } from "@sverka/workflow";
const proj = new Project("myproj");
const pipeline = new Pipeline(proj, "ci");
new ShellStep(pipeline, "build", { command: ${JSON.stringify(`echo '${SARIF_WITH_FINDING}'`)}, runtime: { shell: "sh" }, outputs: { "results.sarif": { type: "artifact", fromStdout: true } } });
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

  it("human output ends with a report: line + view hint pointing at an existing file", async () => {
    const dir = getDir();
    await writefile(dir, "sverka.config.ts", VALID_CONFIG);
    const out = new CaptureWriter();
    const code = await main(["run", "--root", dir, "--format", "text"], {
      output: out,
    });
    expect(code).toBe(0);

    const tail = out.stdoutText.trimEnd().split("\n").pop() ?? "";
    // This fixture's HTML write must succeed — require report.html so a
    // silent fallback to report.json can't pass. The '(sverka view to
    // open)' tail is the Spec 53 funnel contract.
    const match = tail.match(
      /^\s*report: (.+report\.html)\s+\(sverka view to open\)$/,
    );
    if (match === null || match[1] === undefined) {
      throw new Error(
        `tail line should be 'report: <…report.html>  (sverka view to open)', got: ${tail}`,
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
    // Findings count is part of the payload even without --evaluate —
    // data.report.findings advertises it to report.json readers.
    expect(report.data.findings).toEqual(expect.any(Number));
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
          findings: expect.any(Number),
        },
      },
      durationMs: expect.any(Number),
    });
    expect(existsSync(payload.data.report.html)).toBe(true);
    expect(existsSync(payload.data.report.json)).toBe(true);
    // report.json exposes the same findings count the CLI advertised.
    const report = JSON.parse(
      readFileSync(payload.data.report.json, "utf-8"),
    ) as { data: { findings: number } };
    expect(report.data.findings).toBe(payload.data.report.findings);
  });

  it("a second run does not pick up the first run's SARIF (run-scoped artifacts)", async () => {
    // Regression for the run-scoping fix: collectFindings used to scope by
    // sinceMs + 2s mtime epsilon — a run starting moments after another
    // (or running concurrently) could attribute the other run's files.
    // Artifacts now nest under .sverka/artifacts/<runId>/ and collection
    // scans only that run's tree.
    const dir = getDir();
    // Two config FILES: loadConfig caches by module URL within a process,
    // so a rewritten sverka.config.ts would keep serving run 1's config.
    await writefile(dir, "sarif.config.ts", SARIF_CONFIG);
    await writefile(dir, "plain.config.ts", VALID_CONFIG);

    const out1 = new CaptureWriter();
    const code1 = await main(
      ["run", "--root", dir, "--config", "sarif.config.ts", "--format", "json"],
      { output: out1 },
    );
    expect(code1).toBe(0);
    const run1 = JSON.parse(out1.stdoutText) as {
      data: { report: { findings: number } };
    };
    expect(run1.data.report.findings).toBe(1);

    // Same step id, no SARIF output — runs milliseconds after run 1 wrote
    // results.sarif, deep inside any mtime window. Without run scoping,
    // the previous run's file leaks into this run's gate and report.
    const out2 = new CaptureWriter();
    const code2 = await main(
      [
        "run",
        "--root",
        dir,
        "--config",
        "plain.config.ts",
        "--format",
        "json",
        "--evaluate",
      ],
      { output: out2 },
    );
    expect(code2).toBe(0);
    const run2 = JSON.parse(out2.stdoutText) as {
      data: {
        findings: number;
        report: { findings: number };
      };
    };
    expect(run2.data.findings).toBe(0);
    expect(run2.data.report.findings).toBe(0);
  });

  it("refuses to write the report through a symlinked .sverka dir", async () => {
    const dir = getDir();
    await writefile(dir, "sverka.config.ts", VALID_CONFIG);
    // .sverka → outside the root: every report path would escape.
    const outside = await makeTempDir("sverka-escape-");
    const { symlinkSync } = await import("node:fs");
    try {
      symlinkSync(outside, join(dir, ".sverka"));
      const out = new CaptureWriter();
      const code = await main(["run", "--root", dir, "--format", "text"], {
        output: out,
      });
      expect(code).not.toBe(0);
      expect(existsSync(join(outside, "runs"))).toBe(false);
    } finally {
      await cleanupTempDir(outside);
    }
  });

  it("pins the sverka.run/v1 field set (Spec 48 freeze — append-only)", async () => {
    // Reduce a JSON value to its field set: objects become sorted-key maps
    // of shapes, leaves become their typeof tag. Snapshotting the shape —
    // not the values — pins the contract across runs: a rename/removal
    // fails, a new field forces a deliberate `vitest -u` in review.
    const fieldSet = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(fieldSet);
      if (value !== null && typeof value === "object") {
        return Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, fieldSet((value as Record<string, unknown>)[k])]),
        );
      }
      return typeof value;
    };

    const dir = getDir();
    await writefile(dir, "sverka.config.ts", VALID_CONFIG);

    // Plain run — the baseline field set (no eval-only fields).
    const plain = new CaptureWriter();
    expect(
      await main(["run", "--root", dir, "--format", "json"], {
        output: plain,
      }),
    ).toBe(0);
    const plainPayload = JSON.parse(plain.stdoutText.trim());
    expect(plainPayload.schema).toBe("sverka.run/v1");
    expect(fieldSet(plainPayload)).toMatchInlineSnapshot(`
      {
        "command": "string",
        "data": {
          "planId": "string",
          "report": {
            "findings": "number",
            "html": "string",
            "json": "string",
          },
          "status": "string",
          "steps": [
            {
              "durationMs": "number",
              "exitCode": "number",
              "status": "string",
              "stderr": "string",
              "stdout": "string",
              "stepId": "string",
            },
          ],
        },
        "durationMs": "number",
        "schema": "string",
      }
    `);
    const plainReport = JSON.parse(
      readFileSync(plainPayload.data.report.json, "utf-8"),
    );
    expect(plainReport.schema).toBe("sverka.run/v1");
    expect(fieldSet(plainReport)).toMatchInlineSnapshot(`
      {
        "data": {
          "findings": "number",
          "planId": "string",
          "status": "string",
          "steps": [
            {
              "durationMs": "number",
              "exitCode": "number",
              "status": "string",
              "stderr": "string",
              "stdout": "string",
              "stepId": "string",
            },
          ],
          "warnings": [
            "string",
          ],
        },
        "durationMs": "number",
        "schema": "string",
      }
    `);

    // --evaluate run — pins the eval-only additions (findings/verdict/
    // summary) that sit on the same schema. SARIF_CONFIG produces the
    // artifact collectFindings needs; the finding fails the gate.
    const sarifDir = await makeTempDir("sverka-run-schema-eval-");
    try {
      await writefile(sarifDir, "sverka.config.ts", SARIF_CONFIG);
      const evaluated = new CaptureWriter();
      expect(
        await main(
          ["run", "--root", sarifDir, "--format", "json", "--evaluate"],
          { output: evaluated },
        ),
      ).toBe(1);
      const evalPayload = JSON.parse(evaluated.stdoutText.trim());
      expect(fieldSet(evalPayload)).toMatchInlineSnapshot(`
        {
          "command": "string",
          "data": {
            "findings": "number",
            "planId": "string",
            "report": {
              "findings": "number",
              "html": "string",
              "json": "string",
            },
            "status": "string",
            "steps": [
              {
                "durationMs": "number",
                "exitCode": "number",
                "status": "string",
                "stderr": "string",
                "stdout": "string",
                "stepId": "string",
              },
            ],
            "summary": "string",
            "verdict": "string",
          },
          "durationMs": "number",
          "schema": "string",
        }
      `);
      const evalReport = JSON.parse(
        readFileSync(evalPayload.data.report.json, "utf-8"),
      );
      expect(fieldSet(evalReport)).toMatchInlineSnapshot(`
        {
          "data": {
            "findings": "number",
            "planId": "string",
            "status": "string",
            "steps": [
              {
                "durationMs": "number",
                "exitCode": "number",
                "status": "string",
                "stderr": "string",
                "stdout": "string",
                "stepId": "string",
              },
            ],
            "summary": "string",
            "verdict": "string",
          },
          "durationMs": "number",
          "schema": "string",
        }
      `);
    } finally {
      await cleanupTempDir(sarifDir);
    }

    // Failed step — pins the `error` field on the step entry, in both the
    // stdout payload and the persisted report.json (the durable contract is
    // the one readers consume — dropping `error` there must not pass
    // silently just because stdout still carries it).
    const failDir = await makeTempDir("sverka-run-schema-fail-");
    try {
      await writefile(
        failDir,
        "sverka.config.ts",
        `import { Project, Pipeline, ShellStep, Entry } from "@sverka/workflow";
const proj = new Project("myproj");
const pipeline = new Pipeline(proj, "ci");
new ShellStep(pipeline, "test", { command: "exit 3", runtime: { shell: "sh" } });
new Entry(pipeline, "on-push", { trigger: { kind: "push" }, roots: ["test"] });
export default proj;
`,
      );
      const failed = new CaptureWriter();
      expect(
        await main(["run", "--root", failDir, "--format", "json"], {
          output: failed,
        }),
      ).toBe(1);
      const failPayload = JSON.parse(failed.stdoutText.trim());
      expect(fieldSet(failPayload)).toMatchInlineSnapshot(`
        {
          "command": "string",
          "data": {
            "planId": "string",
            "report": {
              "findings": "number",
              "html": "string",
              "json": "string",
            },
            "status": "string",
            "steps": [
              {
                "durationMs": "number",
                "error": "string",
                "exitCode": "number",
                "status": "string",
                "stderr": "string",
                "stdout": "string",
                "stepId": "string",
              },
            ],
          },
          "durationMs": "number",
          "schema": "string",
        }
      `);
      const failReport = JSON.parse(
        readFileSync(failPayload.data.report.json, "utf-8"),
      );
      expect(fieldSet(failReport)).toMatchInlineSnapshot(`
        {
          "data": {
            "findings": "number",
            "planId": "string",
            "status": "string",
            "steps": [
              {
                "durationMs": "number",
                "error": "string",
                "exitCode": "number",
                "status": "string",
                "stderr": "string",
                "stdout": "string",
                "stepId": "string",
              },
            ],
            "warnings": [
              "string",
            ],
          },
          "durationMs": "number",
          "schema": "string",
        }
      `);
    } finally {
      await cleanupTempDir(failDir);
    }
  });

  it("warns and still emits the result when the report dir can't be created", async () => {
    const dir = getDir();
    await writefile(dir, "sverka.config.ts", VALID_CONFIG);
    // .sverka/runs as a FILE: the workspace tree still works (steps run),
    // but mkdir .sverka/runs/<id> fails ENOTDIR — an ordinary fs failure
    // must degrade to a warning, not kill the successful run.
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(join(dir, ".sverka"));
    writeFileSync(join(dir, ".sverka", "runs"), "not a dir");
    const out = new CaptureWriter();
    const code = await main(["run", "--root", dir, "--format", "text"], {
      output: out,
    });
    expect(code).toBe(0);
    expect(out.stderrText).toContain("run report not written");
  });
});
