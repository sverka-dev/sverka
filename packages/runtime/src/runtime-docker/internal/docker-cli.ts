import { spawn } from "node:child_process";

/**
 * Result of a Docker CLI invocation. Not exported from the public API.
 */
export interface DockerCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly timedOut?: boolean;
}

/** Options for runDocker. Not exported from the public API. */
export interface DockerRunOptions {
  /** Timeout in seconds. The container is killed if it exceeds this. */
  readonly timeoutSeconds: number;
  /** Path to the Docker CLI binary. Defaults to "docker". */
  readonly dockerPath?: string;
  /** DOCKER_HOST override. */
  readonly dockerHost?: string;
  /** Optional output byte limit. Excess output is dropped and marked truncated. */
  readonly maxLogBytes?: number;
  /** Optional AbortSignal to cancel the invocation. */
  readonly signal?: AbortSignal;
}

const GRACE_PERIOD_MS = 2000;
const TRUNCATION_NOTICE = "\n[log truncated]";

/**
 * Run a Docker CLI command with the given args. Captures stdout/stderr,
 * resolves the exit code, and enforces a timeout via SIGTERM + SIGKILL grace.
 *
 * This is the single side-effectful seam: unit tests mock it via `vi.mock`,
 * integration tests use the real implementation.
 */
export function runDocker(
  args: readonly string[],
  opts: DockerRunOptions,
): Promise<DockerCommandResult> {
  return new Promise((resolvePromise) => {
    const binary = opts.dockerPath ?? "docker";
    const env: Record<string, string> = { ...process.env } as Record<
      string,
      string
    >;
    if (opts.dockerHost !== undefined) {
      env.DOCKER_HOST = opts.dockerHost;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let truncated = false;
    let byteLimit = opts.maxLogBytes;

    const child = spawn(binary, [...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env,
      signal: opts.signal,
    });

    let closed = false;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      graceTimer = setTimeout(() => {
        if (!closed) {
          child.kill("SIGKILL");
        }
      }, GRACE_PERIOD_MS);
    }, opts.timeoutSeconds * 1000);

    function appendBytes(target: "stdout" | "stderr", data: Buffer): void {
      if (truncated) return;
      if (byteLimit === undefined) {
        if (target === "stdout") {
          stdout += data.toString();
        } else {
          stderr += data.toString();
        }
        return;
      }
      const incoming = data.length;
      if (incoming <= byteLimit) {
        if (target === "stdout") {
          stdout += data.toString();
        } else {
          stderr += data.toString();
        }
        byteLimit -= incoming;
        if (byteLimit === 0) {
          truncated = true;
        }
        return;
      }
      const allowed = byteLimit;
      const slice = data.subarray(0, allowed);
      if (target === "stdout") {
        stdout += slice.toString();
      } else {
        stderr += slice.toString();
      }
      byteLimit = 0;
      truncated = true;
    }

    child.stdout?.on("data", (data: Buffer) => {
      appendBytes("stdout", data);
    });
    child.stderr?.on("data", (data: Buffer) => {
      appendBytes("stderr", data);
    });

    child.on("error", (err) => {
      closed = true;
      if (graceTimer) clearTimeout(graceTimer);
      clearTimeout(timer);
      if (truncated) {
        stdout += TRUNCATION_NOTICE;
      }
      resolvePromise({
        stdout,
        stderr: `spawn error: ${err.message}`,
        exitCode: -1,
        ...(timedOut ? { timedOut: true } : {}),
      });
    });

    child.on("close", (code) => {
      closed = true;
      if (graceTimer) clearTimeout(graceTimer);
      clearTimeout(timer);
      if (truncated) {
        stdout += TRUNCATION_NOTICE;
      }
      resolvePromise({
        stdout,
        stderr,
        exitCode: code ?? -1,
        ...(timedOut ? { timedOut: true } : {}),
      });
    });
  });
}
