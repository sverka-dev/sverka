import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { makeTempDir, cleanupTempDir } from "./helpers/fixtures.js";

const BIN_PATH = join(import.meta.dirname, "..", "..", "dist", "bin.mjs");
const binBuilt = existsSync(BIN_PATH);

describe("sverka binary (acceptance)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it.skipIf(!binBuilt)("spawns and creates a config file via `init`", () => {
    const result = spawnSync("node", [BIN_PATH, "init", "--root", dir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(result.status).toBe(0);
    expect(existsSync(join(dir, "sverka.config.ts"))).toBe(true);
  });

  it.skipIf(!binBuilt)("exits with 2 for unknown command", () => {
    const result = spawnSync("node", [BIN_PATH, "frobnicate", "--root", dir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(result.status).toBe(2);
  });

  it.skipIf(!binBuilt)(
    "--version prints the @sverka/cli version, not cwd's",
    async () => {
      const { writeFile, readFile } = await import("node:fs/promises");
      // A decoy package.json in cwd must not leak into --version output.
      await writeFile(
        join(dir, "package.json"),
        '{"name":"consumer","version":"9.9.9"}',
      );
      const expected = JSON.parse(
        await readFile(
          join(import.meta.dirname, "..", "..", "package.json"),
          "utf8",
        ),
      ).version;
      const result = spawnSync("node", [BIN_PATH, "--version"], {
        cwd: dir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe(expected);
    },
  );

  it.skipIf(!binBuilt)("exits with 0 for doctor", () => {
    const result = spawnSync("node", [BIN_PATH, "doctor", "--root", dir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(result.status).toBe(0);
  });

  it.skipIf(!binBuilt)(
    "validates a config importing @sverka/workflow with no local node_modules (global-install fallback)",
    async () => {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(
        join(dir, "sverka.config.ts"),
        [
          'import { Project, Pipeline, ShellStep, Entry } from "@sverka/workflow";',
          'const proj = new Project("verify");',
          'const ci = new Pipeline(proj, "ci");',
          'new ShellStep(ci, "x", { command: "echo hi" });',
          'new Entry(ci, "on-push", { trigger: { kind: "push" }, roots: ["x"] });',
          "export default proj;",
        ].join("\n"),
        "utf8",
      );
      const result = spawnSync("node", [BIN_PATH, "validate", "--root", dir], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      expect(result.stderr).not.toContain("Cannot find package");
      expect(result.status).toBe(0);
    },
  );
});
