// CLI integration tests for run command with --format text and --evaluate.
// Spec 43 — test plan items 27-30.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
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
new ShellStep(pipeline, "test", { command: "echo test", dependsOn: ["build"] });
new Entry(pipeline, "on-push", { trigger: { kind: "push" }, roots: ["build", "test"] });
export default proj;
`;

const SARIF_WITH_HIGH_FINDING = JSON.stringify({
  version: "2.1.0",
  runs: [
    {
      tool: {
        driver: {
          name: "eslint",
          version: "9.0.0",
          rules: [{ id: "no-unused-vars" }],
        },
      },
      results: [
        {
          ruleId: "no-unused-vars",
          level: "error",
          message: { text: "unused variable" },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: "src/index.ts" },
                region: { startLine: 10, endLine: 10 },
              },
            },
          ],
        },
      ],
    },
  ],
});

function useTempDir() {
  let dir: string;
  beforeEach(async () => {
    dir = await makeTempDir("sverka-run-test-");
  });
  afterEach(async () => {
    await cleanupTempDir(dir);
  });
  return () => dir;
}

/** Config whose build step emits the given SARIF on stdout and exports it
 * via `fromStdout` — exercises the real artifact pipeline instead of a
 * manually placed fixture. */
function sarifStdoutConfig(sarifJson: string): string {
  const echo = JSON.stringify(`echo '${sarifJson}'`);
  return `import { Project, Pipeline, ShellStep, Entry } from "@sverka/workflow";
const proj = new Project("myproj");
const pipeline = new Pipeline(proj, "ci");
new ShellStep(pipeline, "build", { command: ${echo}, runtime: { shell: "sh" }, outputs: { "results.sarif": { type: "artifact", fromStdout: true } } });
new Entry(pipeline, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
export default proj;
`;
}

const SARIF_CONFIG = sarifStdoutConfig(SARIF_WITH_HIGH_FINDING);

/** Same pipeline but the check emits an empty SARIF — artifacts exist, zero
 * findings, policy passes. */
const SARIF_CLEAN_CONFIG = sarifStdoutConfig(
  JSON.stringify({
    version: "2.1.0",
    runs: [{ tool: { driver: { name: "test" } }, results: [] }],
  }),
);

describe("run command — format and evaluate", () => {
  const getDir = useTempDir();

  it("27. --format text produces vitest-style output", async () => {
    const dir = getDir();
    await writefile(dir, "sverka.config.ts", VALID_CONFIG);

    const out = new CaptureWriter();
    const code = await main(["run", "--root", dir, "--format", "text"], {
      output: out,
    });

    expect(code).toBe(0);
    // Text renderer produces step status lines
    expect(out.stdoutText).toContain("ci/build");
    expect(out.stdoutText).toContain("succeeded");
    expect(out.stdoutText).toContain("run completed");
  });

  it("28. --evaluate collects findings and evaluates policy after run", async () => {
    const dir = getDir();
    await writefile(dir, "sverka.config.ts", SARIF_CONFIG);

    const out = new CaptureWriter();
    const code = await main(
      ["run", "--root", dir, "--format", "text", "--evaluate"],
      { output: out },
    );

    // High finding -> policy fail -> exit 1
    expect(code).toBe(1);
    // Should contain findings and policy sections
    expect(out.stdoutText).toContain("Findings");
    expect(out.stdoutText).toContain("Policy:");
    expect(out.stdoutText).toContain("FAIL");
  });

  it("29. --evaluate exits 1 when policy fails", async () => {
    const dir = getDir();
    await writefile(dir, "sverka.config.ts", SARIF_CONFIG);

    const out = new CaptureWriter();
    const code = await main(["run", "--root", dir, "--evaluate"], {
      output: out,
    });

    expect(code).toBe(1);
  });

  it("succeeding step JSON entry has stdout/stderr/exitCode", async () => {
    const dir = getDir();
    await writefile(dir, "sverka.config.ts", VALID_CONFIG);

    const out = new CaptureWriter();
    const code = await main(["run", "--root", dir, "--format", "json"], {
      output: out,
    });

    expect(code).toBe(0);
    const json = JSON.parse(out.stdoutText);
    const build = json.data.steps.find(
      (s: { stepId: string }) => s.stepId === "ci/build",
    );
    expect(build.status).toBe("succeeded");
    expect(build.stdout).toContain("build");
    expect(build.exitCode).toBe(0);
    expect(typeof build.stderr).toBe("string");
  });

  it("failing step JSON entry has stdout/stderr/exitCode", async () => {
    const dir = getDir();
    const FAILING_CONFIG = `import { Project, Pipeline, ShellStep, Entry } from "@sverka/workflow";
const proj = new Project("myproj");
const pipeline = new Pipeline(proj, "ci");
new ShellStep(pipeline, "test", { command: "echo partial-out; echo boom >&2; exit 3", runtime: { shell: "sh" } });
new Entry(pipeline, "on-push", { trigger: { kind: "push" }, roots: ["test"] });
export default proj;
`;
    await writefile(dir, "sverka.config.ts", FAILING_CONFIG);

    const out = new CaptureWriter();
    const code = await main(["run", "--root", dir, "--format", "json"], {
      output: out,
    });

    expect(code).toBe(1);
    const json = JSON.parse(out.stdoutText);
    const step = json.data.steps.find(
      (s: { stepId: string }) => s.stepId === "ci/test",
    );
    expect(step.status).toBe("failed");
    expect(step.exitCode).toBe(3);
    expect(step.stdout).toContain("partial-out");
    expect(step.stderr).toContain("boom");
  });

  it("30. --format json --evaluate includes findings and verdict in JSON output", async () => {
    const dir = getDir();
    await writefile(dir, "sverka.config.ts", SARIF_CONFIG);

    const out = new CaptureWriter();
    const code = await main(
      ["run", "--root", dir, "--format", "json", "--evaluate"],
      { output: out },
    );

    expect(code).toBe(1);
    // JSON output should contain status
    const json = JSON.parse(out.stdoutText);
    expect(json.command).toBe("run");
    expect(json.data.status).toBe("success");
    // JSON output should include per-step results
    expect(Array.isArray(json.data.steps)).toBe(true);
    expect(json.data.steps.length).toBeGreaterThan(0);
    for (const step of json.data.steps) {
      expect(typeof step.stepId).toBe("string");
      expect(typeof step.status).toBe("string");
    }
  });
});

describe("run command — --format html", () => {
  const getDir = useTempDir();

  it("21. --format html --output produces an HTML file", async () => {
    const dir = getDir();
    await writefile(dir, "sverka.config.ts", SARIF_CLEAN_CONFIG);

    const out = new CaptureWriter();
    const outputPath = join(dir, "report.html");
    const code = await main(
      ["run", "--root", dir, "--format", "html", "--output", outputPath],
      { output: out },
    );

    expect(code).toBe(0);
    expect(existsSync(outputPath)).toBe(true);
    const html = await readFile(outputPath, "utf-8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("ci/build");
  });

  it("22. --format html implies --evaluate (findings collected)", async () => {
    const dir = getDir();
    await writefile(dir, "sverka.config.ts", SARIF_CONFIG);

    const out = new CaptureWriter();
    const outputPath = join(dir, "report.html");
    const code = await main(
      ["run", "--root", dir, "--format", "html", "--output", outputPath],
      { output: out },
    );

    // High finding -> policy fail -> exit 1
    expect(code).toBe(1);
    expect(existsSync(outputPath)).toBe(true);
    const html = await readFile(outputPath, "utf-8");
    expect(html).toContain("fail");
  });

  it("23. --format html default output is .sverka/report.html", async () => {
    const dir = getDir();
    await writefile(dir, "sverka.config.ts", SARIF_CLEAN_CONFIG);

    const out = new CaptureWriter();
    const code = await main(["run", "--root", dir, "--format", "html"], {
      output: out,
    });

    expect(code).toBe(0);
    const defaultPath = join(dir, ".sverka", "report.html");
    expect(existsSync(defaultPath)).toBe(true);
  });

  it("--format sarif -o writes SARIF to the given path (documented alias)", async () => {
    const dir = getDir();
    await writefile(dir, "sverka.config.ts", SARIF_CLEAN_CONFIG);

    const out = new CaptureWriter();
    const sarifPath = join(dir, "out.sarif");
    const code = await main(
      ["run", "--root", dir, "--format", "sarif", "-o", sarifPath],
      { output: out },
    );

    expect(code).toBe(0);
    expect(existsSync(sarifPath)).toBe(true);
    const sarif = JSON.parse(await readFile(sarifPath, "utf-8")) as {
      version: string;
    };
    expect(sarif.version).toBe("2.1.0");
  });

  it("--format html prints where the report was written", async () => {
    const dir = getDir();
    await writefile(dir, "sverka.config.ts", SARIF_CLEAN_CONFIG);

    const out = new CaptureWriter();
    const outputPath = join(dir, "report.html");
    const code = await main(
      ["run", "--root", dir, "--format", "html", "--output", outputPath],
      { output: out },
    );

    expect(code).toBe(0);
    expect(out.stdoutText).toContain(`Wrote HTML report to ${outputPath}`);
  });
});
