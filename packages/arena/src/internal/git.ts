/**
 * Internal git seam — the only place the arena spawns `git`. Tests mock
 * this module (vi.mock) to script push conflicts deterministically; it is
 * deliberately not exported from the package index.
 */
import { execFile } from "node:child_process";

export interface GitResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const MAX_BUFFER = 8 * 1024 * 1024;

/** Run `git <args>`; resolves with the exit code, never rejects on non-zero. */
export function git(
  args: readonly string[],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "git", // NOSONAR — fixed binary, args never interpolated into a shell
      [...args],
      {
        cwd: opts.cwd,
        env: { ...process.env, ...opts.env },
        maxBuffer: MAX_BUFFER,
      },
      (error, stdout, stderr) => {
        // Spawn failures (ENOENT), aborts, and signal kills report a
        // non-numeric error.code — the process never exited, so reject.
        if (error !== null && typeof error.code !== "number") {
          reject(error);
          return;
        }
        resolve({
          code: typeof error?.code === "number" ? error.code : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

/** Args carrying credentials must never reach an error message (CWE-209). */
function redactArgs(args: readonly string[]): string {
  return args
    .map((a) =>
      /authorization|bearer|credential|token=/i.test(a) ? "<redacted>" : a,
    )
    .join(" ");
}

/** Run `git <args>`; throws a plain Error with stderr context on non-zero. */
export async function gitOrThrow(
  args: readonly string[],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Promise<GitResult> {
  const res = await git(args, opts);
  if (res.code !== 0) {
    throw new Error(
      `git ${redactArgs(args)} failed (exit ${res.code}): ${res.stderr.trim()}`,
    );
  }
  return res;
}
