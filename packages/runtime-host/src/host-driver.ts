// HostDriver — host process runtime driver.
// Spec 11 — §22.4, §14. Implements RuntimeDriver from @sverka/engine-native.

import { basename } from "node:path";
import { spawn } from "node:child_process";
import type { StepDefinition } from "@sverka/core";
import type { RuntimeDriver, ShellExecuteRequest, ShellResult } from "@sverka/engine-native";
import type { HostDriverConfig } from "./config.js";
import { HostDriverError, CommandNotAllowedError } from "./errors.js";

const DEFAULT_MAX_LOG_BYTES = 10 * 1024 * 1024; // 10 MiB
const GRACE_PERIOD_MS = 2000;
const TRUNCATION_NOTICE = "\n[log truncated]";

// Shell metacharacters that should not appear outside a quoted script token.
const UNSAFE_SHELL_METACHARS = /[<>&|;`$\[\](){}\\!*?~#]/;
const SHELL_BINARIES = new Set(["sh", "bash", "dash", "zsh", "ksh", "fish", "cmd", "powershell", "pwsh"]);

/** Create a host process runtime driver. */
export function createHostDriver(config: HostDriverConfig): RuntimeDriver {
  const maxLogBytes = config.maxLogBytes ?? DEFAULT_MAX_LOG_BYTES;

  return {
    name: "host",

    canExecute(step: StepDefinition): boolean {
      if (!config.enabled) return false;
      const mode = step.runtime.mode;
      if (mode !== undefined && mode !== "host") return false;
      const shellOp = step.operations.find((op: { kind: string }) => op.kind === "shell");
      if (!shellOp || shellOp.kind !== "shell") return false;
      const tokens = tokenize(shellOp.command);
      if (tokens.length === 0) return false;
      return config.allowlist.isAllowed(tokens[0]!);
    },

    async executeShell(request: ShellExecuteRequest): Promise<ShellResult> {
      if (!config.enabled) {
        throw new HostDriverError("host driver is disabled", "EXECUTOR_DISABLED");
      }

      const tokens = tokenize(request.command);
      if (tokens.length === 0) {
        throw new CommandNotAllowedError("empty command is not allowed", { command: request.command });
      }
      const binary = tokens[0]!;
      if (!config.allowlist.isAllowed(binary)) {
        throw new CommandNotAllowedError(
          `command "${request.command}" is not in the allowlist`,
          { command: request.command },
        );
      }
      if (tokens.length > 1 && containsUnsafe(binary, tokens.slice(1))) {
        throw new CommandNotAllowedError(
          `command contains unquoted shell metacharacters outside of an allowed shell script`,
          { command: request.command },
        );
      }

      const env = buildEnv(request, config);
      const cwd = request.cwd ?? request.workspace;
      const args = tokens.slice(1);
      const start = Date.now();

      return new Promise((resolve) => {
        let stdout: Uint8Array = Buffer.alloc(0);
        let stderr: Uint8Array = Buffer.alloc(0);
        let timedOut = false;
        let spawnErrored = false;
        let closed = false;
        let sigkillTimer: ReturnType<typeof setTimeout> | undefined;

        const spawnOptions: {
          cwd: string | undefined;
          env: Record<string, string>;
          stdio: ["ignore", "pipe", "pipe"];
          shell: false;
          detached: true;
          signal?: AbortSignal;
        } = {
          cwd,
          env,
          stdio: ["ignore", "pipe", "pipe"],
          shell: false,
          detached: true,
        };
        if (request.signal !== undefined) {
          spawnOptions.signal = request.signal;
        }
        const child = spawn(binary, args, spawnOptions);

        const timer = request.timeoutMs
          ? setTimeout(() => {
              timedOut = true;
              if (child.pid !== undefined) {
                try {
                  process.kill(-child.pid, "SIGTERM");
                } catch {
                  child.kill("SIGTERM");
                }
              } else {
                child.kill("SIGTERM");
              }
              sigkillTimer = setTimeout(() => {
                if (closed) return;
                if (child.pid !== undefined) {
                  try {
                    process.kill(-child.pid, "SIGKILL");
                  } catch {
                    child.kill("SIGKILL");
                  }
                } else {
                  child.kill("SIGKILL");
                }
              }, GRACE_PERIOD_MS);
            }, request.timeoutMs)
          : undefined;

        const appendStdout = makeAppender(maxLogBytes);
        const appendStderr = makeAppender(maxLogBytes);

        child.stdout?.on("data", (data: Buffer) => {
          stdout = appendStdout(stdout, data);
        });
        child.stderr?.on("data", (data: Buffer) => {
          stderr = appendStderr(stderr, data);
        });

        const finish = (): void => {
          if (closed) return;
          closed = true;
          if (timer) clearTimeout(timer);
          if (sigkillTimer) clearTimeout(sigkillTimer);
        };

        child.on("error", (err) => {
          finish();
          spawnErrored = true;
          resolve({
            exitCode: -1,
            stdout: "",
            stderr: truncateBytes(Buffer.from(`spawn error: ${err.message}`, "utf8"), maxLogBytes).toString("utf8"),
            durationMs: Date.now() - start,
            timedOut: false,
          });
        });

        child.on("close", (code) => {
          finish();
          resolve({
            exitCode: spawnErrored ? -1 : (code ?? -1),
            stdout: truncateBytes(stdout, maxLogBytes).toString("utf8"),
            stderr: truncateBytes(stderr, maxLogBytes).toString("utf8"),
            durationMs: Date.now() - start,
            timedOut,
          });
        });
      });
    },
  };
}

function buildEnv(
  request: ShellExecuteRequest,
  config: HostDriverConfig,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of config.envAllowlist) {
    const val = process.env[key];
    if (val !== undefined) env[key] = val;
  }
  if (config.env) {
    for (const [k, v] of Object.entries(config.env)) {
      if (v !== undefined) env[k] = v as string;
    }
  }
  for (const [k, v] of Object.entries(request.env)) {
    if (v !== undefined) env[k] = v as string;
  }
  return env;
}

function truncateBytes(buffer: Uint8Array, maxBytes: number): Buffer {
  if (buffer.length <= maxBytes) return Buffer.from(buffer);
  const prefix = buffer.subarray(0, maxBytes);
  return Buffer.concat([prefix, Buffer.from(TRUNCATION_NOTICE, "utf8")]);
}

function makeAppender(maxBytes: number) {
  return (buffer: Uint8Array, chunk: Uint8Array): Buffer => {
    if (buffer.length >= maxBytes) return Buffer.from(buffer);
    const free = maxBytes - buffer.length;
    if (chunk.length <= free) {
      return Buffer.concat([buffer, chunk]);
    }
    const prefix = chunk.subarray(0, free);
    return Buffer.concat([buffer, prefix, Buffer.from(TRUNCATION_NOTICE, "utf8")]);
  };
}

/** Tokenize a command string respecting single quotes, double quotes, and backslash escapes. */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (const ch of input) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      if (quote === "'") {
        current += ch;
      } else {
        escaped = true;
      }
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }

  if (current.length > 0) tokens.push(current);
  return tokens;
}

function containsUnsafe(binary: string, args: string[]): boolean {
  // When the binary is an interpreter (sh/bash), its script argument may
  // legitimately contain shell metacharacters; otherwise the tokens are
  // direct command arguments and must not contain metacharacters.
  if (SHELL_BINARIES.has(basename(binary).toLowerCase())) return false;
  return args.some((arg) => UNSAFE_SHELL_METACHARS.test(arg));
}
