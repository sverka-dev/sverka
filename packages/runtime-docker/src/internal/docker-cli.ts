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
}

const GRACE_PERIOD_MS = 2000;

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

    const child = spawn(binary, [...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, GRACE_PERIOD_MS);
    }, opts.timeoutSeconds * 1000);

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolvePromise({
        stdout,
        stderr: `spawn error: ${err.message}`,
        exitCode: -1,
        ...(timedOut ? { timedOut: true } : {}),
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({
        stdout,
        stderr,
        exitCode: code ?? -1,
        ...(timedOut ? { timedOut: true } : {}),
      });
    });
  });
}
