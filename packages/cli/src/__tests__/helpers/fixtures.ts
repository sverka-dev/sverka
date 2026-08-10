import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OutputWriter } from "../../index.js";

/**
 * Create a temporary directory and return its path.
 */
export async function makeTempDir(
  prefix = "sverka-cli-test-",
): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/** Remove a temporary directory recursively. */
export async function cleanupTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/**
 * A test OutputWriter that captures all output in memory.
 */
export class CaptureWriter implements OutputWriter {
  readonly stdout: string[] = [];
  readonly stderr: string[] = [];

  write(text: string): void {
    this.stdout.push(text);
  }
  writeLine(text: string): void {
    this.stdout.push(text + "\n");
  }
  error(text: string): void {
    this.stderr.push(text);
  }
  errorLine(text: string): void {
    this.stderr.push(text + "\n");
  }
  debug(text: string): void {
    this.stderr.push(text + "\n");
  }

  /** Concatenated stdout. */
  get stdoutText(): string {
    return this.stdout.join("");
  }

  /** Concatenated stderr. */
  get stderrText(): string {
    return this.stderr.join("");
  }
}

/**
 * Write a file in a directory, creating parent dirs as needed.
 */
export async function writefile(
  dir: string,
  relPath: string,
  content: string,
): Promise<string> {
  const fullPath = join(dir, relPath);
  const parent = join(fullPath, "..");
  await mkdir(parent, { recursive: true });
  await writeFile(fullPath, content, "utf8");
  return fullPath;
}

/**
 * Init a git repo in the given directory (so planner.discover works).
 * Creates a placeholder file so the initial commit is non-empty.
 */
export async function initGitRepo(dir: string): Promise<void> {
  const { execSync } = await import("node:child_process");
  await writeFile(join(dir, ".gitkeep"), "", "utf8");
  const run = (cmd: string): void => {
    execSync(cmd, { cwd: dir, stdio: "ignore" });
  };
  run("git init");
  run("git config user.email test@example.com");
  run("git config user.name test");
  run("git add -A");
  run('git commit -m "init"');
}
