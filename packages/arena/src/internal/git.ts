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

/**
 * Env for a `git` child.
 *
 * Arena children have no answerable tty — a credential prompt is always a
 * hang, so prompting is disabled unconditionally (not overridable via
 * `opts.env`). `GIT_ASKPASS` must be the empty string, not unset: git
 * falls back to `core.askpass`/`SSH_ASKPASS` only when the var is absent.
 *
 * ssh has its own askpass helper and its own prompt path, which git's
 * settings do not cover — an ssh:// or scp-style remote would prompt for
 * a passphrase on the inherited tty. `BatchMode` makes ssh fail fast
 * instead; an explicit `GIT_SSH_COMMAND` wins, the caller knows what it
 * needs.
 */
function childEnv(opts: {
  env?: Record<string, string>;
}): Record<string, string> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...opts.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "",
    SSH_ASKPASS: "",
    SSH_ASKPASS_REQUIRE: "never",
  };
  if (env["GIT_SSH_COMMAND"] === undefined) {
    env["GIT_SSH_COMMAND"] = "ssh -oBatchMode=yes";
  }
  return env;
}

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
        env: childEnv(opts),
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
 *
 * A scan, not a regex: the obvious pattern (`scheme://[^/]*@`) backtracks
 * quadratically on a long run of `://` — CodeQL's js/polynomial-redos
 * flags it, and the input is attacker-influenced (a remote URL, a git
 * message).
 */
export function redactUrl(value: string): string {
  const SEP = "://";
  let out = "";
  let i = 0;
  while (i < value.length) {
    const sep = value.indexOf(SEP, i);
    if (sep === -1) {
      out += value.slice(i);
      break;
    }
    const userinfoStart = sep + SEP.length;
    const at = value.indexOf("@", userinfoStart);
    const slash = value.indexOf("/", userinfoStart);
    if (at === -1 || (slash !== -1 && slash < at)) {
      // No userinfo before the path — keep looking past this separator.
      out += value.slice(i, userinfoStart);
      i = userinfoStart;
      continue;
    }
    out += value.slice(i, userinfoStart) + "<redacted>@";
    i = at + 1;
  }
  return out;
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
