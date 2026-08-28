import { realpathSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import type { Executor, ExecuteRequest, ExecuteResult } from "../index.js";
import type { PlanOperation } from "@sverka/workflow";
import type { DockerExecutorConfig } from "./config.js";
import { ContainerPolicyError, DockerExecutorError } from "./errors.js";
import { verifyImageDigest } from "./image.js";
import { DockerCacheManager } from "./cache.js";
import { runDocker } from "./internal/docker-cli.js";

const DEFAULT_MAX_LOG_BYTES = 10 * 1024 * 1024; // 10 MiB
const DEFAULT_RUN_AS = "1000:1000";
const TRUNCATION_NOTICE = "\n[log truncated]";

/** Resolve and normalize a path, following symlinks when possible. */
function canonicalPath(raw: string): string {
  const absolute = isAbsolute(raw) ? raw : resolve(raw);
  try {
    return normalize(realpathSync(absolute));
  } catch {
    return normalize(absolute);
  }
}

/** Return true when the canonical path points to a Docker socket. */
function refersToDockerSocket(raw: string): boolean {
  return basename(canonicalPath(raw)) === "docker.sock";
}

/** Extract the `source=` value from a Docker `--mount` string. */
function mountSource(mount: string): string | undefined {
  const match = mount.match(/(?:^|,)source=([^,]+)/);
  return match?.[1];
}

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
  private readonly cacheManager: DockerCacheManager | null;

  constructor(config: DockerExecutorConfig) {
    this.config = config;
    this.maxLogBytes = config.maxLogBytes ?? DEFAULT_MAX_LOG_BYTES;
    this.cacheManager = config.cacheDir
      ? new DockerCacheManager(config.cacheDir)
      : null;
  }

  private get runAs(): string {
    return this.config.runAs ?? DEFAULT_RUN_AS;
  }

  canExecute(operation: PlanOperation): boolean {
    return operation.executor.type === "docker";
  }

  /**
   * Construct the `docker run` argument array. Pure — no side effects.
   * Throws `ContainerPolicyError` (DOCKER_SOCKET_DENIED) if any mount source
   * references the Docker socket.
   */
  buildDockerArgs(request: ExecuteRequest, cachePath?: string): string[] {
    const op = request.operation;
    const args = this.buildBaseArgs(op);
    const netFlag = this.networkFlag(op.network);
    if (netFlag !== undefined) args.push("--network", netFlag);
    args.push(...this.buildMountArgs(request, cachePath));
    const env = this.buildEnv(request);
    for (const [k, v] of Object.entries(env)) args.push("--env", `${k}=${v}`);
    args.push(this.imageRef(op));
    if (op.command !== undefined) args.push(op.command);
    if (op.args !== undefined) args.push(...op.args);
    return args;
  }

  private buildBaseArgs(op: PlanOperation): string[] {
    return [
      "run",
      "--rm",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--user",
      this.runAs,
      "--memory",
      op.resources.memory,
      "--cpus",
      op.resources.cpu,
      "--workdir",
      "/workspace",
    ];
  }

  private buildMountArgs(request: ExecuteRequest, cachePath?: string): string[] {
    const workspaceMount = `type=bind,source=${request.workspace},target=/workspace,readonly`;
    const cacheSource = cachePath ?? request.cacheDir;
    const cacheMount = `type=bind,source=${cacheSource},target=/cache`;
    const artifactMount = `type=bind,source=${request.artifactDir},target=/artifacts`;
    const mounts: string[] = [];
    for (const mount of [workspaceMount, cacheMount, artifactMount]) {
      const source = mountSource(mount);
      if (source && refersToDockerSocket(source)) {
        throw new ContainerPolicyError(
          "Docker socket must not be mounted into the container",
          { mount, source: canonicalPath(source) },
          "DOCKER_SOCKET_DENIED",
        );
      }
      mounts.push("--mount", mount);
    }
    return mounts;
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
          "UNDECLARED_SECRET",
        );
      }
      if (typeof v === "string" && refersToDockerSocket(v)) {
        throw new ContainerPolicyError(
          "Docker socket must not be referenced in env values",
          { envVar: k, value: canonicalPath(v) },
          "DOCKER_SOCKET_DENIED",
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

    let cachePath: string | undefined;
    if (op.cache && this.cacheManager) {
      cachePath = await this.cacheManager.prepare(
        op.cache.inputs,
        op.cache.key,
        request.workspace,
      );
    }

    const image = op.executor.image ?? "";
    const digest = op.executor.imageDigest;
    if (digest !== undefined) {
      await verifyImageDigest(image, digest, this.config);
    }

    const args = this.buildDockerArgs(request, cachePath);
    const result = await this.runContainer(args, op);

    if (op.cache && this.cacheManager && cachePath !== undefined) {
      await this.cacheManager.collect(op.cache.outputs, cachePath, op.cache.key);
    }

    return this.finalizeResult(result, op, request, start);
  }

  /** Validate executor type, timeout, and image digest. */
  private validateRequest(op: PlanOperation): void {
    if (op.executor.type !== "docker") {
      throw new ContainerPolicyError(
        `expected executor.type "docker", got "${op.executor.type}"`,
        { type: op.executor.type },
        "WRONG_EXECUTOR_TYPE",
      );
    }
    if (op.timeoutSeconds === undefined || op.timeoutSeconds <= 0) {
      throw new ContainerPolicyError(
        "timeoutSeconds must be present and > 0",
        { timeoutSeconds: op.timeoutSeconds },
        "MISSING_TIMEOUT",
      );
    }
    if (op.executor.imageDigest === undefined) {
      throw new ContainerPolicyError(
        "docker operations require executor.imageDigest",
        { image: op.executor.image },
        "MISSING_DIGEST",
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
      maxLogBytes: Math.max(0, this.maxLogBytes - TRUNCATION_NOTICE.length),
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
    if (result.exitCode < 0) {
      return {
        operationId: op.id,
        status: "failure",
        durationMs,
        logs,
        artifacts: [],
        error: `docker CLI failed: ${result.stderr || "unknown spawn error"}`,
        runtimeFailure: true,
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
    if (this.maxLogBytes <= TRUNCATION_NOTICE.length) {
      return TRUNCATION_NOTICE.slice(0, this.maxLogBytes);
    }
    return (
      logs.slice(0, this.maxLogBytes - TRUNCATION_NOTICE.length) +
      TRUNCATION_NOTICE
    );
  }

  private async collectArtifacts(
    op: PlanOperation,
    workspace: string,
    artifactDir: string,
  ): Promise<{ collected: string[]; errors: string[] }> {
    const collected: string[] = [];
    const errors: string[] = [];
    const artifactRoot = resolve(artifactDir);

    for (const artifact of op.artifacts) {
      if (isAbsolute(artifact.path)) {
        errors.push(
          `artifact path must not be absolute: ${artifact.path}`,
        );
        continue;
      }
      const src = join(workspace, artifact.path);
      const rel = artifact.name ?? artifact.path;
      const dest = resolve(artifactDir, rel);
      if (!this.isInsideDir(dest, artifactRoot)) {
        errors.push(`artifact destination escapes artifactDir: ${rel}`);
        continue;
      }
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

  private isInsideDir(path: string, root: string): boolean {
    const rel = relative(root, path);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  }
}

const SECRET_DENYLIST =
  /^(?:.*_)?(?:SECRET|TOKEN|PASSWORD|CREDENTIAL|(?<!PUBLIC_)KEY)$/i;
