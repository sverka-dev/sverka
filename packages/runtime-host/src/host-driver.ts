// HostDriver — host process runtime driver.
// Spec 11 — §22.4, §14. Implements RuntimeDriver from @sverka/engine-native.
// Reuses allowlist, env building, timeout, and log truncation patterns
// from the old host-executor.ts.

import { spawn } from "node:child_process";
import type { StepDefinition } from "@sverka/core";
import type { RuntimeDriver, ShellExecuteRequest, ShellResult } from "@sverka/engine-native";
import type { HostDriverConfig } from "./config.js";
import type { CommandAllowlist } from "./allowlist.js";
import { HostDriverError, CommandNotAllowedError } from "./errors.js";

const DEFAULT_MAX_LOG_BYTES = 10 * 1024 * 1024; // 10 MiB
const GRACE_PERIOD_MS = 2000;
const TRUNCATION_NOTICE = "\n[log truncated]";

/** Create a host process runtime driver. */
export function createHostDriver(config: HostDriverConfig): RuntimeDriver {
  const maxLogBytes = config.maxLogBytes ?? DEFAULT_MAX_LOG_BYTES;

  return {
    name: "host",

    canExecute(step: StepDefinition): boolean {
      if (!config.enabled) return false;
      const mode = step.runtime.mode;
      if (mode !== undefined && mode !== "host") return false;
      // Check the first shell operation's command against the allowlist.
      const shellOp = step.operations.find((op: { kind: string }) => op.kind === "shell");
      if (!shellOp || shellOp.kind !== "shell") return false;
      return config.allowlist.isAllowed(extractBinary(shellOp.command));
    },

    async executeShell(request: ShellExecuteRequest): Promise<ShellResult> {
      if (!config.enabled) {
        throw new HostDriverError("host driver is disabled", "EXECUTOR_DISABLED");
      }
      if (!config.allowlist.isAllowed(extractBinary(request.command))) {
        throw new CommandNotAllowedError(
          `command "${request.command}" is not in the allowlist`,
          { command: request.command },
        );
      }

      const env = buildEnv(request, config);
      const cwd = request.cwd ?? request.workspace;
      const start = Date.now();

      return new Promise((resolve) => {
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        let spawnErrored = false;

        const child = spawn(request.command, [], {
          cwd,
          env,
          stdio: ["ignore", "pipe", "pipe"],
          shell: true,
          detached: true,
        });

        const timer = request.timeoutMs
          ? setTimeout(() => {
              timedOut = true;
              try {
                process.kill(-child.pid!, "SIGTERM");
              } catch {
                child.kill("SIGTERM");
              }
              setTimeout(() => {
                try {
                  process.kill(-child.pid!, "SIGKILL");
                } catch {
                  if (!child.killed) child.kill("SIGKILL");
                }
              }, GRACE_PERIOD_MS);
            }, request.timeoutMs)
          : undefined;

        child.stdout?.on("data", (data: Buffer) => {
          stdout += data.toString();
        });
        child.stderr?.on("data", (data: Buffer) => {
          stderr += data.toString();
        });

        child.on("error", (err) => {
          if (timer) clearTimeout(timer);
          spawnErrored = true;
          resolve({
            exitCode: -1,
            stdout: "",
            stderr: truncate(`spawn error: ${err.message}`, maxLogBytes),
            durationMs: Date.now() - start,
            timedOut: false,
          });
        });

        child.on("close", (code, signal) => {
          if (spawnErrored) return;
          if (timer) clearTimeout(timer);
          const logs = truncate(stdout + (stderr ? "\n" + stderr : ""), maxLogBytes);
          resolve({
            exitCode: code ?? -1,
            stdout: truncate(stdout, maxLogBytes),
            stderr: truncate(stderr, maxLogBytes),
            durationMs: Date.now() - start,
            timedOut,
          });
          // Signal is unused but available if needed.
          void signal;
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
  // Forward allowlisted host env vars.
  for (const key of config.envAllowlist) {
    const val = process.env[key];
    if (val !== undefined) env[key] = val;
  }
  // Merge config env overrides.
  if (config.env) {
    for (const [k, v] of Object.entries(config.env)) env[k] = v;
  }
  // Merge request env (includes SVERKA_OUTPUT_DIR).
  for (const [k, v] of Object.entries(request.env)) env[k] = v;
  return env;
}

function truncate(logs: string, maxBytes: number): string {
  if (logs.length <= maxBytes) return logs;
  return logs.slice(0, maxBytes) + TRUNCATION_NOTICE;
}

/** Extract the binary name from a command string (first word). */
function extractBinary(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return "";
  // Handle shell builtins and complex commands by taking the first token.
  const firstToken = trimmed.split(/\s+/)[0] ?? "";
  return firstToken;
}
