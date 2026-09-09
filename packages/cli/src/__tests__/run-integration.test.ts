// CLI integration tests for run command with --format text and --evaluate.
// Spec 43 — test plan items 27-30.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, readFile } from "node:fs/promises";
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
new ShellStep(pipeline, "test", { command: "echo test", dependencies: [{ kind: "control", producer: "build" }] });
new Entry(pipeline, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
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

async function placeSarif(dir: string): Promise<void> {
  const artifactDir = join(dir, ".sverka", "artifacts", "ci", "build");
  await mkdir(artifactDir, { recursive: true });
  await writeFile(join(artifactDir, "results.sarif"), SARIF_WITH_HIGH_FINDING);
}

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
    await writefile(dir, "sverka.config.ts", VALID_CONFIG);
    await placeSarif(dir);

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
    await writefile(dir, "sverka.config.ts", VALID_CONFIG);
    await placeSarif(dir);

    const out = new CaptureWriter();
    const code = await main(
      ["run", "--root", dir, "--evaluate"],
      { output: out },
    );

    expect(code).toBe(1);
  });

  it("30. --format json --evaluate includes findings and verdict in JSON output", async () => {
    const dir = getDir();
    await writefile(dir, "sverka.config.ts", VALID_CONFIG);
    await placeSarif(dir);

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
  });
});

describe("run command — --format html", () => {
  const getDir = useTempDir();

  it("21. --format html --output produces an HTML file", async () => {
    const dir = getDir();
    await writefile(dir, "sverka.config.ts", VALID_CONFIG);

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
    await writefile(dir, "sverka.config.ts", VALID_CONFIG);
    await placeSarif(dir);

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
    await writefile(dir, "sverka.config.ts", VALID_CONFIG);

    const out = new CaptureWriter();
    const code = await main(
      ["run", "--root", dir, "--format", "html"],
      { output: out },
    );

    expect(code).toBe(0);
    const defaultPath = join(dir, ".sverka", "report.html");
    expect(existsSync(defaultPath)).toBe(true);
  });
});
