/**
 * Configuration for the Docker runtime driver.
 * Spec 12 — Interfaces.
 */
export interface DockerDriverConfig {
  /** Path to the Docker CLI. Defaults to auto-detect ("docker"). */
  readonly dockerPath?: string;
  /** Docker host socket URL (DOCKER_HOST). Defaults to inherited. */
  readonly dockerHost?: string;
  /** Default non-root uid:gid for containers. Defaults to "1000:1000". */
  readonly runAs?: string;
  /** Maximum log size in bytes before truncation. Defaults to 10 MiB. */
  readonly maxLogBytes?: number;
  /** Network mode. Defaults to "none". */
  readonly network?: string;
}
