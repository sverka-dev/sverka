import { copyFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { Executor, ExecuteRequest, ExecuteResult } from "@sverka/runtime";
import type { PlanOperation } from "@sverka/ir";
import type { DockerExecutorConfig } from "./config.js";
import { ContainerPolicyError } from "./errors.js";
import { runDocker } from "./internal/docker-cli.js";

const DEFAULT_MAX_LOG_BYTES = 10 * 1024 * 1024; // 10 MiB
const TRUNCATION_NOTICE = "\n[log truncated]";
const DOCKER_SOCKET_MARKER = "docker.sock";

/**
 * Docker implementation of the Executor interface.
 *
 * Enforces a strict container execution policy: read-only root filesystem,
 * dropped capabilities, no network by default, non-root user, bounded CPU and
 * memory, mandatory timeout, secrets allowlist, and the Docker socket is never
 * mounted into the container.
 */
export class DockerExecutor implements Executor {
  readonly name = "docker";
  private readonly config: DockerExecutorConfig;
  private readonly maxLogBytes: number;

  constructor(config: DockerExecutorConfig) {
    this.config = config;
    this.maxLogBytes = config.maxLogBytes ?? DEFAULT_MAX_LOG_BYTES;
  }

  canExecute(operation: PlanOperation): boolean {
    return operation.executor.type === "docker";
  }

  /**
   * Construct the `docker run` argument array. Pure — no side effects.
   * Throws `ContainerPolicyError` (DOCKER_SOCKET_DENIED) if any mount source
   * references the Docker socket.
   */
  buildDockerArgs(request: ExecuteRequest): string[] {
    const op = request.operation;
    const args: string[] = [
      "run",
      "--rm",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--user",
      this.config.runAs,
      "--memory",
      op.resources.memory,
      "--cpus",
      op.resources.cpu,
      "--timeout",
      String(op.timeoutSeconds),
      "--workdir",
      "/workspace",
    ];

    // Network policy mapping.
    const netFlag = this.networkFlag(op.network);
    if (netFlag !== undefined) {
      args.push("--network", netFlag);
    }

    // Bind mounts: workspace (read-only), cache, artifacts.
    const workspaceMount = `type=bind,source=${request.workspace},target=/workspace,readonly`;
    const cacheMount = `type=bind,source=${request.cacheDir},target=/cache`;
    const artifactMount = `type=bind,source=${request.artifactDir},target=/artifacts`;
    for (const mount of [workspaceMount, cacheMount, artifactMount]) {
      if (mount.includes(DOCKER_SOCKET_MARKER)) {
        throw new ContainerPolicyError(
          "Docker socket must not be mounted into the container",
          { mount },
        );
      }
      args.push("--mount", mount);
    }

    // Environment variables (allowlisted credentials + request env).
    const env = this.buildEnv(request);
    for (const [k, v] of Object.entries(env)) {
      args.push("--env", `${k}=${v}`);
    }

    // Image with digest pinning.
    const image = this.imageRef(op);
    args.push(image);

    // Command + args.
    if (op.command !== undefined) {
      args.push(op.command);
    }
    if (op.args !== undefined) {
      args.push(...op.args);
    }

    return args;
  }

  /**
   * Build the container environment from `operation.credentials` (declarations)
   * + `request.credentials` (values) + `request.env`. Pure.
   *
   * Throws `ContainerPolicyError` (UNDECLARED_SECRET) if a secret-like env var
   * in `request.env` is not declared in `operation.credentials`, and
   * (DOCKER_SOCKET_DENIED) if any env value references the Docker socket.
   */
  buildEnv(request: ExecuteRequest): Record<string, string> {
    const op = request.operation;
    const declaredEnvVars = new Set(op.credentials.map((c) => c.envVar));
    const env: Record<string, string> = {};

    // Only declared credentials get values from request.credentials.
    for (const decl of op.credentials) {
      const val = request.credentials[decl.envVar];
      if (val !== undefined) {
        env[decl.envVar] = val;
      }
    }

    // request.env provides operation env vars, but secret-like names must be
    // declared in credentials.
    for (const [k, v] of Object.entries(request.env)) {
      if (SECRET_DENYLIST.test(k) && !declaredEnvVars.has(k)) {
        throw new ContainerPolicyError(
          `env var "${k}" looks like a secret but is not declared in operation.credentials`,
          { envVar: k },
        );
      }
      if (typeof v === "string" && v.includes(DOCKER_SOCKET_MARKER)) {
        throw new ContainerPolicyError(
          "Docker socket must not be referenced in env values",
          { envVar: k },
        );
      }
      env[k] = v;
    }

    return env;
  }

  async execute(request: ExecuteRequest): Promise<ExecuteResult> {
    const op = request.operation;
    const start = Date.now();
    this.validateRequest(op);
    const args = this.buildDockerArgs(request);
    const result = await this.runContainer(args, op);
    return this.finalizeResult(result, op, request, start);
  }

  /** Validate executor type, timeout, and image digest. */
  private validateRequest(op: PlanOperation): void {
    if (op.executor.type !== "docker") {
      throw new ContainerPolicyError(
        `expected executor.type "docker", got "${op.executor.type}"`,
        { type: op.executor.type },
      );
    }
    if (op.timeoutSeconds === undefined || op.timeoutSeconds <= 0) {
      throw new ContainerPolicyError(
        "timeoutSeconds must be present and > 0",
        { timeoutSeconds: op.timeoutSeconds },
      );
    }
    if (op.executor.imageDigest === undefined) {
      throw new ContainerPolicyError(
        "docker operations require executor.imageDigest",
        { image: op.executor.image },
      );
    }
  }

  /** Spawn docker and build the base ExecuteResult. */
  private async runContainer(
    args: string[],
    op: PlanOperation,
  ): Promise<ExecuteResult> {
    const start = Date.now();
    const result = await runDocker(args, {
      timeoutSeconds: op.timeoutSeconds,
      ...(this.config.dockerPath !== undefined
        ? { dockerPath: this.config.dockerPath }
        : {}),
      ...(this.config.dockerHost !== undefined
        ? { dockerHost: this.config.dockerHost }
        : {}),
    });
    const durationMs = Date.now() - start;
    const rawLogs =
      result.stdout + (result.stderr ? "\n" + result.stderr : "");
    const logs = this.truncateLogs(rawLogs);
    if (result.timedOut === true) {
      return {
        operationId: op.id,
        status: "failure",
        ...(result.exitCode >= 0 ? { exitCode: result.exitCode } : {}),
        durationMs,
        logs,
        artifacts: [],
        error: `timeout after ${op.timeoutSeconds}s`,
      };
    }
    const status = result.exitCode === 0 ? "success" : "failure";
    return {
      operationId: op.id,
      status,
      ...(result.exitCode >= 0 ? { exitCode: result.exitCode } : {}),
      durationMs,
      logs,
      artifacts: [],
      ...(status === "failure" ? { error: `exit code ${result.exitCode}` } : {}),
    };
  }

  /** Collect artifacts and merge errors into the base result. */
  private async finalizeResult(
    base: ExecuteResult,
    op: PlanOperation,
    request: ExecuteRequest,
    start: number,
  ): Promise<ExecuteResult> {
    const artifacts = await this.collectArtifacts(
      op,
      request.workspace,
      request.artifactDir,
    );
    const durationMs = Date.now() - start;
    if (artifacts.errors.length > 0) {
      const existingError = base.error ?? "";
      const artifactError = `artifact errors: ${artifacts.errors.join("; ")}`;
      return {
        ...base,
        durationMs,
        artifacts: artifacts.collected,
        error: existingError
          ? `${existingError}; ${artifactError}`
          : artifactError,
      };
    }
    return { ...base, durationMs, artifacts: artifacts.collected };
  }

  async dispose(): Promise<void> {
    // No persistent resources to clean up.
  }

  // --- internals ---

  private networkFlag(network: PlanOperation["network"]): string | undefined {
    switch (network) {
      case "deny":
        return "none";
      case "allow-host":
        return "host";
      case "allow-egress":
        return undefined; // default bridge
      default:
        return "none";
    }
  }

  private imageRef(op: PlanOperation): string {
    const image = op.executor.image ?? "";
    const digest = op.executor.imageDigest;
    if (digest !== undefined) {
      return `${image}@${digest}`;
    }
    return image;
  }

  private truncateLogs(logs: string): string {
    if (logs.length <= this.maxLogBytes) return logs;
    return logs.slice(0, this.maxLogBytes) + TRUNCATION_NOTICE;
  }

  private async collectArtifacts(
    op: PlanOperation,
    workspace: string,
    artifactDir: string,
  ): Promise<{ collected: string[]; errors: string[] }> {
    const collected: string[] = [];
    const errors: string[] = [];

    for (const artifact of op.artifacts) {
      const src = isAbsolute(artifact.path)
        ? artifact.path
        : join(workspace, artifact.path);
      const dest = join(artifactDir, artifact.name ?? artifact.path);
      try {
        await mkdir(dirname(dest), { recursive: true });
        await copyFile(src, dest);
        collected.push(dest);
      } catch {
        errors.push(`missing artifact: ${artifact.path}`);
      }
    }

    return { collected, errors };
  }
}

const SECRET_DENYLIST = /^(?:.*_)?(?:SECRET|TOKEN|PASSWORD|KEY|CREDENTIAL)$/i;
