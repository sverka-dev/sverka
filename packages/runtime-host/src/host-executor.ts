import { spawn } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { Executor, ExecuteRequest, ExecuteResult } from "@sverka/runtime";
import type { PlanOperation } from "@sverka/ir";
import type { HostExecutorConfig } from "./config.js";
import {
  HostExecutorError,
  CommandNotAllowedError,
} from "./errors.js";

const DEFAULT_MAX_LOG_BYTES = 10 * 1024 * 1024; // 10 MiB
const GRACE_PERIOD_MS = 2000;
const TRUNCATION_NOTICE = "\n[log truncated]";

/**
 * Host process implementation of the Executor interface.
 *
 * Restricted: only operations with executor.type === "host" are eligible,
 * and only when config.enabled is true.
 */
export class HostExecutor implements Executor {
  readonly name = "host";
  private readonly config: HostExecutorConfig;
  private readonly maxLogBytes: number;

  constructor(config: HostExecutorConfig) {
    // Validate at construction: no privilege escalation.
    if (config.runAsUid === 0) {
      throw new HostExecutorError(
        "runAsUid must not be 0 (root)",
        "PRIVILEGE_ESCALATION",
        { runAsUid: config.runAsUid },
      );
    }
    for (const entry of config.allowlist.entries) {
      const base = entry.split("/").pop() ?? entry;
      if (base === "sudo" || base === "su") {
        throw new HostExecutorError(
          `allowlist must not contain "${base}"`,
          "PRIVILEGE_ESCALATION",
          { entry },
        );
      }
    }
    this.config = config;
    this.maxLogBytes = config.maxLogBytes ?? DEFAULT_MAX_LOG_BYTES;
  }

  canExecute(operation: PlanOperation): boolean {
    if (!this.config.enabled) return false;
    if (operation.executor.type !== "host") return false;
    const command = operation.command ?? "";
    if (!this.config.allowlist.isAllowed(command)) return false;
    if (operation.timeoutSeconds === undefined || operation.timeoutSeconds <= 0) {
      return false;
    }
    return true;
  }

  async execute(request: ExecuteRequest): Promise<ExecuteResult> {
    const op = request.operation;
    const start = Date.now();
    const command = this.validateRequest(op);
    const cwd = this.resolveCwd(op, request.workspace);
    const env = this.buildEnv(request);
    const result = await this.spawnProcess(
      command,
      [...(op.args ?? [])],
      cwd,
      env,
      op.timeoutSeconds,
      start,
      op.id,
    );
    return this.finalizeResult(result, op, request, start);
  }

  /** Validate enabled, executor type, timeout, and allowlist. Returns command. */
  private validateRequest(op: PlanOperation): string {
    if (!this.config.enabled) {
      throw new HostExecutorError("host executor is disabled", "EXECUTOR_DISABLED");
    }
    if (op.executor.type !== "host") {
      throw new HostExecutorError(
        `expected executor.type "host", got "${op.executor.type}"`,
        "WRONG_EXECUTOR_TYPE",
        { type: op.executor.type },
      );
    }
    if (op.timeoutSeconds === undefined || op.timeoutSeconds <= 0) {
      throw new HostExecutorError(
        "timeoutSeconds must be present and > 0",
        "MISSING_TIMEOUT",
        { timeoutSeconds: op.timeoutSeconds },
      );
    }
    const command = op.command ?? "";
    if (!this.config.allowlist.isAllowed(command)) {
      throw new CommandNotAllowedError(
        `command "${command}" is not in the allowlist`,
        { command },
      );
    }
    return command;
  }

  /** Collect artifacts and merge into the spawn result. */
  private async finalizeResult(
    result: ExecuteResult,
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
      const existingError = result.error ?? "";
      const artifactError = `artifact errors: ${artifacts.errors.join("; ")}`;
      return {
        ...result,
        durationMs,
        artifacts: artifacts.collected,
        error: existingError ? `${existingError}; ${artifactError}` : artifactError,
      };
    }
    return { ...result, durationMs, artifacts: artifacts.collected };
  }

  async dispose(): Promise<void> {
    // No persistent resources to clean up.
  }

  // --- internals ---

  private resolveCwd(op: PlanOperation, workspace: string): string {
    if (op.workingDir === undefined) {
      return workspace;
    }
    const resolved = isAbsolute(op.workingDir)
      ? op.workingDir
      : resolve(workspace, op.workingDir);
    const rel = relative(workspace, resolved);
    if (rel.startsWith("..")) {
      throw new HostExecutorError(
        `workingDir "${op.workingDir}" resolves outside workspace`,
        "WORKDIR_OUTSIDE_WORKSPACE",
        { workingDir: op.workingDir, workspace, resolved },
      );
    }
    return resolved;
  }

  private buildEnv(request: ExecuteRequest): Record<string, string> {
    const env: Record<string, string> = {};
    // Forward only envAllowlist entries from the host environment.
    for (const key of this.config.envAllowlist) {
      const val = process.env[key];
      if (val !== undefined) {
        env[key] = val;
      }
    }
    // Merge config.env overrides.
    if (this.config.env) {
      for (const [k, v] of Object.entries(this.config.env)) {
        env[k] = v;
      }
    }
    // Merge request.credentials (resolved secret values, keyed by envVar).
    for (const [k, v] of Object.entries(request.credentials)) {
      env[k] = v;
    }
    // Merge request.env (operation env vars).
    for (const [k, v] of Object.entries(request.env)) {
      env[k] = v;
    }
    return env;
  }

  private spawnProcess(
    command: string,
    args: string[],
    cwd: string,
    env: Record<string, string>,
    timeoutSeconds: number,
    start: number,
    operationId: string,
  ): Promise<ExecuteResult> {
    return new Promise((resolvePromise) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let spawnErrored = false;

      const child = spawn(command, args, {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) {
            child.kill("SIGKILL");
          }
        }, GRACE_PERIOD_MS);
      }, timeoutSeconds * 1000);

      child.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });
      child.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        spawnErrored = true;
        const durationMs = Date.now() - start;
        const logs = this.truncateLogs(`stderr: ${err.message}`);
        resolvePromise({
          operationId,
          status: "failure",
          durationMs,
          logs,
          artifacts: [],
          error: `spawn error: ${err.message}`,
          runtimeFailure: true,
        });
      });

      child.on("close", (code) => {
        if (spawnErrored) {
          // The 'error' event already resolved the promise with a runtime failure.
          return;
        }
        clearTimeout(timer);
        const durationMs = Date.now() - start;
        const rawLogs = stdout + (stderr ? "\n" + stderr : "");
        const logs = this.truncateLogs(rawLogs);

        if (timedOut) {
          resolvePromise({
            operationId,
            status: "failure",
            durationMs,
            ...(code !== null ? { exitCode: code } : {}),
            logs,
            artifacts: [],
            error: `timeout after ${timeoutSeconds}s`,
          });
          return;
        }

        // Negative or null exit codes indicate the process could not be spawned
        // or was terminated by a signal; treat these as runtime failures.
        if (code === null || code < 0) {
          resolvePromise({
            operationId,
            status: "failure",
            durationMs,
            logs,
            artifacts: [],
            error: `spawn error: exit code ${code}`,
            runtimeFailure: true,
          });
          return;
        }

        const status = code === 0 ? "success" : "failure";
        resolvePromise({
          operationId,
          status,
          ...(code !== null ? { exitCode: code } : {}),
          durationMs,
          logs,
          artifacts: [],
          ...(status === "failure" ? { error: `exit code ${code}` } : {}),
        });
      });
    });
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
