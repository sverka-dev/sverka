// DockerDriver — OCI container runtime driver.
// Spec 12 — §22.4, §14. Implements RuntimeDriver from @sverka/engine-native.

import { isAbsolute, normalize, relative } from "node:path";
import type { StepDefinition } from "@sverka/core";
import type { RuntimeDriver, ShellExecuteRequest, ShellResult } from "@sverka/engine-native";
import type { DockerDriverConfig } from "./config.js";
import { DockerExecutorError, ContainerPolicyError } from "./errors.js";
import { runDocker } from "./internal/docker-cli.js";
import { verifyImageDigest } from "./image.js";

const DEFAULT_MAX_LOG_BYTES = 10 * 1024 * 1024; // 10 MiB
const DEFAULT_RUN_AS = "1000:1000";
const DEFAULT_NETWORK = "none";
const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes
const CONTAINER_WORKSPACE = "/workspace";

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
        throw new DockerExecutorError("no image specified for container execution", "NO_IMAGE");
      }

      if (request.workspace.toLowerCase().includes("docker.sock")) {
        throw new ContainerPolicyError(
          `refusing to mount workspace path containing docker.sock: ${request.workspace}`,
          undefined,
          "DOCKER_SOCK_MOUNT",
        );
      }

      validateEnv(request.env);

      if (request.imageDigest) {
        await verifyImageDigest(image, request.imageDigest, config, request.timeoutMs, request.signal);
      }

      const containerCwd = toContainerPath(request.cwd ?? request.workspace, request.workspace);
      const containerEnv = buildContainerEnv(request.env, request.workspace);

      const args = buildDockerArgs(request, runAs, network, image, containerCwd, containerEnv);
      const start = Date.now();
      const timeoutSeconds = Math.ceil((request.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000);

      const runDockerOptions: {
        timeoutSeconds: number;
        dockerPath: string;
        maxLogBytes: number;
        dockerHost?: string;
        signal?: AbortSignal;
      } = {
        timeoutSeconds,
        dockerPath,
        maxLogBytes,
      };
      if (config.dockerHost !== undefined) {
        runDockerOptions.dockerHost = config.dockerHost;
      }
      if (request.signal !== undefined) {
        runDockerOptions.signal = request.signal;
      }
      const result = await runDocker(args, runDockerOptions);

      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: Date.now() - start,
        timedOut: result.timedOut ?? false,
      };
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
  containerCwd?: string,
  containerEnv?: Readonly<Record<string, string>>,
): string[] {
  const cwd = containerCwd ?? toContainerPath(request.cwd ?? request.workspace, request.workspace);
  const env = containerEnv ?? buildContainerEnv(request.env, request.workspace);

  const args: string[] = [
    "run",
    "--rm",
    "--read-only",
    "--cap-drop=ALL",
    `--user=${runAs}`,
    `--network=${network}`,
    "-v", `${request.workspace}:${CONTAINER_WORKSPACE}`,
    "-w", cwd,
  ];

  for (const [k, v] of Object.entries(env)) {
    args.push("--env", `${k}=${v}`);
  }

  if (request.timeoutMs) {
    args.push(`--stop-timeout=${Math.ceil(request.timeoutMs / 1000)}`);
  }

  // Terminate option parsing so an image name starting with "--" cannot be
  // interpreted as a Docker flag.
  args.push("--", image);
  args.push("sh", "-c", request.command);

  return args;
}

function validateEnv(env: Readonly<Record<string, string>>): void {
  for (const [k, v] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
      throw new ContainerPolicyError(`invalid environment variable name: ${k}`, undefined, "INVALID_ENV");
    }
    if (k.includes("\n") || k.includes("\r")) {
      throw new ContainerPolicyError(`environment variable name contains newline: ${k}`, undefined, "INVALID_ENV");
    }
    if (v.includes("\n") || v.includes("\r") || v.includes("\0")) {
      throw new ContainerPolicyError(`environment variable contains unsafe character: ${k}`, undefined, "INVALID_ENV");
    }
  }
}

function buildContainerEnv(
  env: Readonly<Record<string, string>>,
  workspace: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    out[k] = k === "SVERKA_OUTPUT_DIR" ? toContainerPath(v, workspace) : v;
  }
  return out;
}

function toContainerPath(hostPath: string, workspace: string): string {
  const resolvedHost = normalize(hostPath);
  const resolvedWorkspace = normalize(workspace);
  const rel = relative(resolvedWorkspace, resolvedHost);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new ContainerPolicyError(
      `container path escapes workspace: '${hostPath}'`,
      { hostPath, workspace },
      "PATH_ESCAPE",
    );
  }
  return rel === "" ? CONTAINER_WORKSPACE : `${CONTAINER_WORKSPACE}/${rel}`;
}
