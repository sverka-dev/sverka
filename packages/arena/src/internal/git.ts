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
        // Arena children have no answerable tty — a credential prompt is
        // always a hang, so prompting is disabled unconditionally (not
        // overridable via opts.env). GIT_ASKPASS must be the empty string,
        // not unset: git falls back to core.askpass/SSH_ASKPASS only when
        // the var is absent.
        env: {
          ...process.env,
          ...opts.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_ASKPASS: "",
        },
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

/**
 * Replace URL userinfo with `<redacted>` — `https://user:TOKEN@host`
 * leaks the token into argv and any stderr that echoes it (CWE-209).
 * scp-style `git@host:path` carries no credential and is left alone.
 */
export function redactUrl(value: string): string {
  return value.replace(
    /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^/\s@]*@/g,
    "$1<redacted>@",
  );
}

/** Args carrying credentials must never reach an error message (CWE-209). */
function redactArgs(args: readonly string[]): string {
  return args
    .map((a) =>
      /authorization|bearer|credential|token=/i.test(a)
        ? "<redacted>"
        : redactUrl(a),
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
      `git ${redactArgs(args)} failed (exit ${res.code}): ${redactUrl(res.stderr.trim())}`,
    );
  }
  return res;
}
