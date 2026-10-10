// @sverka/hub — shared types. Spec 55.

/** An API token with an access level. */
export interface HubToken {
  /** Human label for the token (from the tokens file). */
  readonly name: string;
  readonly token: string;
  /** `ro` can only read; `rw` can also write. */
  readonly access: "ro" | "rw";
}

/** Options for the self-hosted hub server. */
export interface HubServerOptions {
  /** Data directory — blobs, snapshots, and the SQLite index live here. */
  readonly dataDir: string;
  /** Port to listen on (default: 7357). `0` picks an ephemeral port. */
  readonly port?: number;
  /** Host to bind (default: "0.0.0.0" — a hub usually serves a LAN/CI net). */
  readonly host?: string;
  /** Explicit token list. When omitted, tokens are loaded from
   *  `<dataDir>/tokens` (name:token:ro|rw lines) plus the
   *  `SVERKA_HUB_ADMIN_TOKEN` env var. */
  readonly tokens?: readonly HubToken[];
  /** Max cache blob size in bytes (default: 512 MiB → 413 above). */
  readonly maxBlobBytes?: number;
  /** Max JSON body size for run uploads (default: 32 MiB). */
  readonly maxJsonBytes?: number;
}

export interface HubServer {
  readonly port: number;
  readonly url: string;
  readonly dataDir: string;
  close(): Promise<void>;
}

/** A run record stored by POST /v1/runs. */
export interface HubStoredRun {
  readonly runId: string;
  readonly project: string;
  readonly entry: string;
  readonly status: string;
  readonly startedAt: number | null;
  readonly durationMs: number | null;
  /** JSON: `{ total, bySeverity }`. */
  readonly findingCounts: string;
  readonly policyVerdict: string | null;
  readonly uploadedAt: number;
  readonly reportJson: string;
  readonly findingsJson: string;
}
