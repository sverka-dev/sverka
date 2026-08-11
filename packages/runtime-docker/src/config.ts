/**
 * Configuration for the Docker executor.
 *
 * `workspace` and `artifactDir` are NOT here — they arrive per-execution via
 * `ExecuteRequest`. This config is executor-wide.
 */
export interface DockerExecutorConfig {
  /** Path to the Docker CLI. Defaults to auto-detect ("docker"). */
  readonly dockerPath?: string;
  /** Docker host socket URL (DOCKER_HOST). Defaults to inherited. */
  readonly dockerHost?: string;
  /** Default non-root uid:gid for containers. Defaults to "1000:1000". */
  readonly runAs?: string;
  /** Persistent directory for cache layers (managed by DockerCacheManager). */
  readonly cacheDir: string;
  /** Maximum log size in bytes before truncation. Defaults to 10 MiB. */
  readonly maxLogBytes?: number;
}
