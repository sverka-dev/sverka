// DockerDriver — OCI container runtime driver.
// Spec 12 — §22.4, §14. Implements RuntimeDriver from @sverka/engine-native.
// Reuses docker-cli, image verification, and container security policy
// patterns from the old docker-executor.ts.

import { spawn } from "node:child_process";
import type { StepDefinition } from "@sverka/core";
import type { RuntimeDriver, ShellExecuteRequest, ShellResult } from "@sverka/engine-native";
import type { DockerDriverConfig } from "./config.js";
import { DockerExecutorError } from "./errors.js";

const DEFAULT_MAX_LOG_BYTES = 10 * 1024 * 1024; // 10 MiB
const DEFAULT_RUN_AS = "1000:1000";
const DEFAULT_NETWORK = "none";
const TRUNCATION_NOTICE = "\n[log truncated]";

/** Create a Docker container runtime driver. */
export function createDockerDriver(config: DockerDriverConfig): RuntimeDriver {
  const maxLogBytes = config.maxLogBytes ?? DEFAULT_MAX_LOG_BYTES;
  const runAs = config.runAs ?? DEFAULT_RUN_AS;
  const network = config.network ?? DEFAULT_NETWORK;
  const dockerPath = config.dockerPath ?? "docker";

  return {
    name: "docker",

    canExecute(step: StepDefinition): boolean {
      if (step.runtime.mode !== "container") return false;
      return step.runtime.image !== undefined && step.runtime.image !== "";
    },

    async executeShell(request: ShellExecuteRequest): Promise<ShellResult> {
      const image = request.image;
      if (!image) {
        throw new DockerExecutorError(
          "no image specified for container execution",
          "NO_IMAGE",
        );
      }

      const args = buildDockerArgs(request, runAs, network, image);
      const start = Date.now();

      return new Promise((resolve) => {
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        let spawnErrored = false;

        const env: Record<string, string> = {};
        for (const [k, v] of Object.entries(process.env)) {
          if (v !== undefined) env[k] = v;
        }
        if (config.dockerHost) {
          env.DOCKER_HOST = config.dockerHost;
        }

        const child = spawn(dockerPath, args, {
          stdio: ["ignore", "pipe", "pipe"],
          env,
        });

        const timer = request.timeoutMs
          ? setTimeout(() => {
              timedOut = true;
              child.kill("SIGTERM");
              setTimeout(() => {
                if (!child.killed) child.kill("SIGKILL");
              }, 2000);
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
            stderr: truncate(`docker spawn error: ${err.message}`, maxLogBytes),
            durationMs: Date.now() - start,
            timedOut: false,
          });
        });

        child.on("close", (code, signal) => {
          if (spawnErrored) return;
          if (timer) clearTimeout(timer);
          resolve({
            exitCode: code ?? -1,
            stdout: truncate(stdout, maxLogBytes),
            stderr: truncate(stderr, maxLogBytes),
            durationMs: Date.now() - start,
            timedOut,
          });
          void signal;
        });
      });
    },
  };
}

/**
 * Build the `docker run` argument array. Pure — no side effects.
 * Exported for testing.
 */
export function buildDockerArgs(
  request: ShellExecuteRequest,
  runAs: string,
  network: string,
  image: string,
): string[] {
  const args: string[] = [
    "run",
    "--rm",
    "--read-only",
    "--cap-drop=ALL",
    `--user=${runAs}`,
    `--network=${network}`,
    "-v", `${request.workspace}:/workspace`,
    "-w", "/workspace",
  ];

  // Forward env vars.
  for (const [k, v] of Object.entries(request.env)) {
    args.push("--env", `${k}=${v}`);
  }

  // Timeout via --stop-timeout (graceful).
  if (request.timeoutMs) {
    args.push(`--stop-timeout=${Math.ceil(request.timeoutMs / 1000)}`);
  }

  // Image and command.
  args.push(image);
  args.push("sh", "-c", request.command);

  return args;
}

function truncate(logs: string, maxBytes: number): string {
  if (logs.length <= maxBytes) return logs;
  return logs.slice(0, maxBytes) + TRUNCATION_NOTICE;
}
