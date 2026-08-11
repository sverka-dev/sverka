import { spawn } from "node:child_process";

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
 * Default `GitCli` implementation backed by `node:child_process.spawn`.
 */
export function createGitCli(): GitCli {
  return {
    run(args, cwd) {
      return new Promise<string>((resolvePromise, reject) => {
        // Pass an explicit, sanitized environment so PATH cannot be hijacked
        // by untrusted environment variables leaking into the git subprocess.
        const env: NodeJS.ProcessEnv = {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME,
          GIT_TERMINAL_PROMPT: "0",
        };
        const child = spawn("git", [...args], {
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
