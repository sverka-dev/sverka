import type { CommandAllowlist } from "./allowlist.js";

/**
 * Configuration for the host process executor (old API).
 *
 * `workspace` and `artifactDir` are NOT here — they arrive per-execution via
 * `ExecuteRequest`. This config is executor-wide.
 */
export interface HostExecutorConfig {
  /** Must be true to enable the host executor. Defaults to false. */
  readonly enabled: boolean;
  /** Allowlist of binary names or absolute paths that may be executed. */
  readonly allowlist: CommandAllowlist;
  /** Env vars from the host that are forwarded to child processes. */
  readonly envAllowlist: readonly string[];
  /** Extra env vars to inject. */
  readonly env?: Readonly<Record<string, string>>;
  /** Maximum log size in bytes before truncation. Defaults to 10 MiB. */
  readonly maxLogBytes?: number;
  /** Default uid to run as. Defaults to current user. Not elevated. */
  readonly runAsUid?: number;
}

/**
 * Configuration for the host runtime driver (new API).
 * Spec 11 — Interfaces.
 */
export interface HostDriverConfig {
  /** Must be true to enable the host driver. Defaults to false. */
  readonly enabled: boolean;
  /** Allowlist of binary names or absolute paths that may be executed. */
  readonly allowlist: CommandAllowlist;
  /** Env vars from the host that are forwarded to child processes. */
  readonly envAllowlist: readonly string[];
  /** Extra env vars to inject. */
  readonly env?: Readonly<Record<string, string>>;
  /** Maximum log size in bytes before truncation. Defaults to 10 MiB. */
  readonly maxLogBytes?: number;
}
