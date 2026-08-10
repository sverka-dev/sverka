import { spawnSync } from "node:child_process";

/**
 * Check if a binary is available on PATH by spawning `<binary> --version`.
 * Returns true if the binary exists and exits 0, false otherwise.
 */
export function isBinaryAvailable(binary: string): boolean {
  const result = spawnSync(binary, ["--version"], {
    stdio: ["ignore", "pipe", "ignore"],
    encoding: "utf8",
  });
  return result.status === 0 && result.error === undefined;
}
