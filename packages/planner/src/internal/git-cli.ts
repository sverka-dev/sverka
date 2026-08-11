import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * A mockable seam over the `git` CLI. Unit tests mock this via `vi.mock`;
 * integration tests use the real implementation.
 *
 * NOT exported from the public API.
 */
export interface GitCli {
  /**
   * Run a git command in `cwd`, returning stdout. Rejects with an Error
   * whose `cause` carries stderr when the exit code is non-zero.
   */
  run(args: readonly string[], cwd: string): Promise<string>;
}

/**
 * Resolve the absolute path to the `git` executable by searching `PATH`
 * at this trusted parent level. The spawned child receives a minimal
 * environment without `PATH`, mitigating PATH-injection hotspots.
 */
function resolveGitBinary(): string {
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(":")) {
    if (!dir) continue;
    const candidate = `${dir}/git`;
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return "git";
}

const GIT_BINARY = resolveGitBinary();

/**
 * Default `GitCli` implementation backed by `node:child_process.spawn`.
 */
export function createGitCli(): GitCli {
  return {
    run(args, cwd) {
      return new Promise<string>((resolvePromise, reject) => {
        // Spawn the resolved git binary with a minimal, explicit environment
        // that does not propagate PATH into the child subprocess.
        const env: NodeJS.ProcessEnv = {
          HOME: process.env.HOME,
          GIT_TERMINAL_PROMPT: "0",
        };
        const child = spawn(GIT_BINARY, [...args], {
          cwd,
          env,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (data: Buffer) => {
          stdout += data.toString();
        });
        child.stderr?.on("data", (data: Buffer) => {
          stderr += data.toString();
        });
        child.on("error", (err) => {
          reject(err);
        });
        child.on("close", (code) => {
          if (code === 0) {
            resolvePromise(stdout);
          } else {
            reject(
              new Error(
                `git ${args.join(" ")} exited ${code ?? -1}`,
                stderr.trim() ? { cause: stderr.trim() } : undefined,
              ),
            );
          }
        });
      });
    },
  };
}
