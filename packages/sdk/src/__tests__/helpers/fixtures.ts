import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline, run, task, defineWorkflow, workflow, type WorkflowDefinition } from "../../index.js";

/**
 * Create a temporary directory and return its path. Clean up with cleanupTempDir.
 */
export async function makeTempDir(prefix = "sverka-sdk-test-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/** Remove a temporary directory recursively. */
export async function cleanupTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/**
 * Write a sverka.config.ts file in the given directory that exports a
 * default WorkflowDefinition with a single run operation.
 */
export async function writeSimpleConfig(
  dir: string,
  command = "true",
  args: readonly string[] = [],
): Promise<string> {
  const configPath = join(dir, "sverka.config.ts");
  const argsText = args.length > 0 ? `, args: ${JSON.stringify(args)}` : "";
  const content = `import { defineWorkflow, pipeline, task, run } from "@sverka/sdk";
export default defineWorkflow({
  name: "test",
  workflow: pipeline(task("op", run({ command: ${JSON.stringify(command)}${argsText} }))),
});
`;
  await writeFile(configPath, content, "utf8");
  return configPath;
}

/**
 * Write a sverka.config.ts with a failing command (exit code 1).
 */
export async function writeFailingConfig(dir: string): Promise<string> {
  return writeSimpleConfig(dir, "false");
}

/**
 * Write a sverka.config.ts with a malformed default export (not a valid
 * WorkflowDefinition).
 */
export async function writeMalformedConfig(dir: string): Promise<string> {
  const configPath = join(dir, "sverka.config.ts");
  const content = `export default { not: "a workflow" };
`;
  await writeFile(configPath, content, "utf8");
  return configPath;
}

/**
 * Write a sverka.config.ts with a syntax error.
 */
export async function writeSyntaxErrorConfig(dir: string): Promise<string> {
  const configPath = join(dir, "sverka.config.ts");
  const content = `export default defineWorkflow({
`;
  await writeFile(configPath, content, "utf8");
  return configPath;
}

/**
 * Write a sverka.config.js (JavaScript fallback) in the given directory.
 */
export async function writeJsConfig(dir: string): Promise<string> {
  const configPath = join(dir, "sverka.config.js");
  const content = `export default {
  name: "js-config",
  workflow: { name: "js", roots: [], plan: async () => ({ mode: "plan", operations: [], durationMs: 0 }) },
};
`;
  await writeFile(configPath, content, "utf8");
  return configPath;
}

/**
 * Create a nested directory structure: dir/sub/sub2 and write the config
 * in the deepest level. Returns the deepest dir (where config lives).
 */
export async function writeNestedConfig(
  dir: string,
  depth = 3,
): Promise<string> {
  let current = dir;
  for (let i = 0; i < depth; i++) {
    current = join(current, `level${i}`);
    await mkdir(current, { recursive: true });
  }
  await writeSimpleConfig(current);
  return current;
}

/**
 * Create a temporary git repo with a single commit. Used for planner tests
 * that require a git repository.
 */
export async function makeTempGitRepo(): Promise<string> {
  const dir = await makeTempDir("sverka-git-");
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name test", { cwd: dir, stdio: "pipe" });
  await writeFile(join(dir, "README.md"), "# test\n", "utf8");
  execSync("git add . && git commit -m init", { cwd: dir, stdio: "pipe" });
  return dir;
}

/**
 * Create a temporary git repo with a package.json (bun workspace) so the
 * planner detects bun as a package manager and proposes Node checks.
 */
export async function makeTempGitRepoWithPackageJson(): Promise<string> {
  const dir = await makeTempDir("sverka-git-pkg-");
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name test", { cwd: dir, stdio: "pipe" });
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      name: "test-pkg",
      version: "1.0.0",
      packageManager: "bun@1.2.0",
    }),
    "utf8",
  );
  await writeFile(join(dir, "tsconfig.json"), "{}", "utf8");
  await writeFile(join(dir, "index.ts"), "export const x = 1;\n", "utf8");
  execSync("git add . && git commit -m init", { cwd: dir, stdio: "pipe" });
  return dir;
}

/**
 * Build a simple WorkflowDefinition in-memory (no file I/O).
 */
export function makeSimpleWorkflowDefinition(
  command = "true",
): WorkflowDefinition {
  return defineWorkflow({
    name: "test",
    workflow: workflow("test", pipeline(task("op", run({ command })))),
  });
}
