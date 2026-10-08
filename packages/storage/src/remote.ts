// Remote hub client — CacheStore + SnapshotStore adapters over the hub's
// /v1/ HTTP API, plus run-report upload and run listing.
// Spec 55 — Remote Run Hub.
//
// Every remote failure surfaces as a HubError. Callers (the engine for
// cache, the CLI for uploads) catch it and degrade to local behaviour +
// a warn diagnostic — the hub is never in a run's critical path.

import {
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join, dirname, resolve, sep } from "node:path";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";
import type {
  CacheRestoreRequest,
  CacheRestoreResult,
  CacheStore,
  CacheStoreRequest,
  RunSnapshot,
  SnapshotStore,
} from "@sverka/runtime";
import type { Finding } from "@sverka/verification";
import { HubError } from "./errors.js";
import { serialize, deserialize } from "./internal/serialize.js";
import { packTar, unpackTar } from "./internal/tar.js";
import type { TarEntry } from "./internal/tar.js";

/**
 * Connection settings for a hub. `url` is the hub base URL (no /v1
 * suffix); `project` namespaces cache keys, runs, and snapshots
 * (e.g. "sverka-dev/sverka").
 */
export interface RemoteStoreConfig {
  readonly url: string;
  readonly token: string;
  readonly project: string;
  /** Connect timeout — default 3 000 ms. */
  readonly timeoutMs?: number;
  /** Body transfer timeout — default 30 000 ms. */
  readonly bodyTimeoutMs?: number;
  /** Shared auth breaker: when set, a 401/403 marks it and every later
   *  request in the run fails fast as REMOTE_UNAVAILABLE (Spec 55 —
   *  "warn once naming `sverka login`, then behave as hub-down for the
   *  rest of the run"). */
  readonly circuit?: RemoteCircuit;
}

/** Mutable auth breaker shared by all remote adapters of one run. */
export interface RemoteCircuit {
  authFailed: boolean;
}

export function createRemoteCircuit(): RemoteCircuit {
  return { authFailed: false };
}

/** Index row returned by `GET /v1/runs` — the dashboard list view. */
export interface HubRunSummary {
  readonly runId: string;
  readonly project: string;
  readonly entry: string;
  readonly status: string;
  readonly startedAt: number | null;
  readonly durationMs: number | null;
  readonly findingCounts: {
    readonly total: number;
    readonly bySeverity: Record<string, number>;
  };
  readonly policyVerdict?: string;
}

/** Full stored run returned by `GET /v1/runs/{runId}`. */
export interface HubRunDetail extends HubRunSummary {
  readonly report: Record<string, unknown>;
  readonly findings: readonly unknown[];
  readonly uploadedAt: number;
}

/** Metadata the caller attaches to a run upload. */
export interface RunUploadMeta {
  /** Entry id the run executed. */
  readonly entry: string;
  /** The run's own id — lets the hub key the row to the local runId. */
  readonly runId?: string;
}

export interface RunUploadResult {
  readonly runId: string;
  readonly url: string;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 3_000;
const DEFAULT_BODY_TIMEOUT_MS = 30_000;

interface HubResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: Uint8Array;
}

async function hubRequest(
  config: RemoteStoreConfig,
  method: "GET" | "PUT" | "POST" | "DELETE",
  path: string,
  body?: Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<HubResponse> {
  if (config.circuit?.authFailed === true) {
    throw new HubError(
      "REMOTE_UNAVAILABLE",
      `hub auth failed earlier this run — treated as hub-down (${method} ${path})`,
    );
  }
  const base = config.url.replace(/\/+$/, "");
  const ac = new AbortController();
  let timer = setTimeout(
    () =>
      ac.abort(
        new Error(
          `connect timeout after ${config.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS}ms`,
        ),
      ),
    config.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
  );
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${config.token}`,
        ...(body !== undefined ? { "content-type": contentType } : {}),
      },
      ...(body !== undefined ? { body } : {}),
      signal: ac.signal,
    });
  } catch (e) {
    throw new HubError(
      "REMOTE_UNAVAILABLE",
      `hub unreachable (${method} ${path}): ${e instanceof Error ? e.message : String(e)}`,
      e,
    );
  } finally {
    clearTimeout(timer);
  }
  // A 401/403 trips the breaker — later requests skip the network.
  if (
    config.circuit !== undefined &&
    (res.status === 401 || res.status === 403)
  ) {
    config.circuit.authFailed = true;
  }
  // Response headers arrived — the body gets its own, longer budget.
  timer = setTimeout(
    () =>
      ac.abort(
        new Error(
          `body timeout after ${config.bodyTimeoutMs ?? DEFAULT_BODY_TIMEOUT_MS}ms`,
        ),
      ),
    config.bodyTimeoutMs ?? DEFAULT_BODY_TIMEOUT_MS,
  );
  try {
    const buf = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, body: buf };
  } catch (e) {
    throw new HubError(
      "REMOTE_UNAVAILABLE",
      `hub body read failed (${method} ${path}): ${e instanceof Error ? e.message : String(e)}`,
      e,
    );
  } finally {
    clearTimeout(timer);
  }
}

function rejected(method: string, path: string, res: HubResponse): HubError {
  const detail = new TextDecoder().decode(res.body).slice(0, 200);
  const authHint =
    res.status === 401 || res.status === 403
      ? " — run `sverka login` to refresh the hub token"
      : "";
  return new HubError(
    "REMOTE_REJECTED",
    `hub ${method} ${path} → ${res.status}${authHint}${detail === "" ? "" : `: ${detail}`}`,
    undefined,
    res.status,
  );
}

// --- Cache blob packing (tar.zst over declared paths) ---

async function collectTarEntries(
  sourceDir: string,
  relPath: string,
  out: TarEntry[],
): Promise<void> {
  const abs = join(sourceDir, relPath);
  const st = await lstat(abs);
  const name = relPath.split("\\").join("/");
  if (st.isDirectory()) {
    out.push({ name, type: "dir", mtime: Math.floor(st.mtimeMs / 1000) });
    const children = await readdir(abs);
    children.sort();
    for (const child of children) {
      await collectTarEntries(sourceDir, join(relPath, child), out);
    }
  } else if (st.isSymbolicLink()) {
    out.push({
      name,
      type: "symlink",
      linkname: await readlink(abs),
      mtime: Math.floor(st.mtimeMs / 1000),
    });
  } else if (st.isFile()) {
    out.push({
      name,
      type: "file",
      data: new Uint8Array(await readFile(abs)),
      mtime: Math.floor(st.mtimeMs / 1000),
    });
  }
  // Sockets/fifos/devices are not cached — skipped silently.
}

/** Manifest entry stored inside the tar — same shape as the file cache's
 *  manifest.json so both backends describe one entry identically. */
const MANIFEST_NAME = ".sverka-cache-manifest.json";

async function packCacheBlob(
  sourceDir: string,
  paths: readonly string[],
  key: string,
): Promise<Uint8Array> {
  const entries: TarEntry[] = [
    {
      name: MANIFEST_NAME,
      type: "file",
      data: new TextEncoder().encode(
        JSON.stringify({ key, paths, createdAt: new Date().toISOString() }),
      ),
    },
  ];
  for (const path of paths) {
    await collectTarEntries(sourceDir, path, entries);
  }
  return new Uint8Array(zstdCompressSync(Buffer.from(packTar(entries))));
}

function assertEntryName(name: string): void {
  if (
    name === "" ||
    name.startsWith("/") ||
    name.includes("\\") ||
    name.split("/").includes("..")
  ) {
    throw new HubError(
      "REMOTE_REJECTED",
      `cache blob entry escapes the target dir: ${name}`,
    );
  }
}

/** Extract a tar.zst blob's declared paths into targetDir. */
async function extractCacheBlob(
  blob: Uint8Array,
  paths: readonly string[],
  targetDir: string,
): Promise<void> {
  const tar = unpackTar(new Uint8Array(zstdDecompressSync(Buffer.from(blob))));
  const wanted = new Set(paths.map((p) => p.split("\\").join("/")));
  for (const entry of tar) {
    assertEntryName(entry.name);
    if (entry.name === MANIFEST_NAME) continue;
    // Only extract declared paths (or children of declared dirs).
    if (
      ![...wanted].some(
        (p) => entry.name === p || entry.name.startsWith(`${p}/`),
      )
    ) {
      continue;
    }
    const dest = join(targetDir, entry.name);
    if (entry.type === "dir") {
      await mkdir(dest, { recursive: true });
    } else if (entry.type === "file" && entry.data !== undefined) {
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, entry.data);
    } else if (entry.type === "symlink" && entry.linkname !== undefined) {
      // Link targets must stay inside the target dir — a blob that plants
      // a symlink to /etc would escape the cache sandbox. resolve() (not
      // join()) so absolute targets fail containment rather than being
      // silently re-rooted.
      const link = entry.linkname;
      if (link.startsWith("/") || link.includes("\\")) continue;
      const resolved = resolve(dirname(dest), link);
      const realTarget = resolve(targetDir);
      if (
        resolved !== realTarget &&
        !resolved.startsWith(`${realTarget}${sep}`)
      ) {
        continue;
      }
      await mkdir(dirname(dest), { recursive: true });
      await symlink(link, dest);
    }
  }
}

/**
 * Remote `CacheStore` (Spec 55): `store` archives the declared paths into
 * a tar.zst blob and `PUT`s it; `restore` `GET`s the primary key and each
 * restoreKey in order — the hub answers exact matches first, then the
 * newest entry whose key has the requested prefix (same semantics as the
 * file cache).
 *
 * Failures throw `HubError`; the engine treats CacheStore failures as
 * non-fatal misses/warns, and `createTieredCacheStore` degrades to local.
 */
export function createRemoteCacheStore(config: RemoteStoreConfig): CacheStore {
  const pathFor = (key: string) =>
    `/v1/cache/${encodeURIComponent(config.project)}/${encodeURIComponent(key)}`;

  return {
    async restore(
      req: CacheRestoreRequest,
    ): Promise<CacheRestoreResult | undefined> {
      for (const key of [req.key, ...req.restoreKeys]) {
        const res = await hubRequest(config, "GET", pathFor(key));
        if (res.status === 404) continue;
        if (res.status !== 200) throw rejected("GET", pathFor(key), res);
        await extractCacheBlob(res.body, req.paths, req.targetDir);
        return { key: res.headers.get("x-sverka-cache-key") ?? key };
      }
      return undefined;
    },

    async store(req: CacheStoreRequest): Promise<void> {
      const blob = await packCacheBlob(req.sourceDir, req.paths, req.key);
      const res = await hubRequest(config, "PUT", pathFor(req.key), blob);
      if (res.status >= 300) throw rejected("PUT", pathFor(req.key), res);
    },
  };
}

/**
 * Remote `SnapshotStore` (Spec 55): suspend/resume across machines.
 * Snapshots are the serialized `RunSnapshot` JSON unchanged — the hub
 * treats them as opaque documents.
 */
export function createRemoteSnapshotStore(
  config: RemoteStoreConfig,
): SnapshotStore {
  const pathFor = (runId: string) =>
    `/v1/snapshots/${encodeURIComponent(config.project)}/${encodeURIComponent(runId)}`;

  return {
    async save(snapshot: RunSnapshot): Promise<void> {
      const res = await hubRequest(
        config,
        "PUT",
        pathFor(snapshot.runId),
        serialize(snapshot),
        "application/json",
      );
      if (res.status >= 300) {
        throw rejected("PUT", pathFor(snapshot.runId), res);
      }
    },

    async load(runId: string): Promise<RunSnapshot | undefined> {
      const res = await hubRequest(config, "GET", pathFor(runId));
      if (res.status === 404) return undefined;
      if (res.status !== 200) throw rejected("GET", pathFor(runId), res);
      return deserialize(new TextDecoder().decode(res.body), runId);
    },

    async delete(runId: string): Promise<void> {
      const res = await hubRequest(config, "DELETE", pathFor(runId));
      if (res.status === 404) return;
      if (res.status >= 300) {
        throw rejected("DELETE", pathFor(runId), res);
      }
    },
  };
}

/**
 * Upload a run report + normalized findings to the hub (`POST /v1/runs`).
 * `report` is the `sverka.run/v1` payload written to report.json — sent
 * verbatim. Returns the hub-assigned runId and detail URL.
 */
export async function uploadRunReport(
  config: RemoteStoreConfig,
  report: Record<string, unknown>,
  findings: readonly Finding[],
  meta: RunUploadMeta,
): Promise<RunUploadResult> {
  const body = JSON.stringify({
    project: config.project,
    entry: meta.entry,
    ...(meta.runId !== undefined ? { runId: meta.runId } : {}),
    report,
    findings,
  });
  const res = await hubRequest(
    config,
    "POST",
    "/v1/runs",
    body,
    "application/json",
  );
  if (res.status !== 200 && res.status !== 201) {
    throw rejected("POST", "/v1/runs", res);
  }
  const parsed = JSON.parse(new TextDecoder().decode(res.body)) as {
    runId?: unknown;
    url?: unknown;
  };
  return {
    runId: typeof parsed.runId === "string" ? parsed.runId : "unknown",
    url: typeof parsed.url === "string" ? parsed.url : "",
  };
}

/** List remote run summaries, newest first. */
export async function listRuns(
  config: RemoteStoreConfig,
  opts?: { limit?: number; before?: number },
): Promise<HubRunSummary[]> {
  const params = new URLSearchParams({ project: config.project });
  if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts?.before !== undefined) params.set("before", String(opts.before));
  const res = await hubRequest(config, "GET", `/v1/runs?${params}`);
  if (res.status !== 200) throw rejected("GET", "/v1/runs", res);
  return JSON.parse(new TextDecoder().decode(res.body)) as HubRunSummary[];
}

/** Fetch one stored run (report + findings). 404 → undefined. */
export async function getRun(
  config: RemoteStoreConfig,
  runId: string,
): Promise<HubRunDetail | undefined> {
  const res = await hubRequest(
    config,
    "GET",
    `/v1/runs/${encodeURIComponent(runId)}`,
  );
  if (res.status === 404) return undefined;
  if (res.status !== 200) throw rejected("GET", `/v1/runs/${runId}`, res);
  return JSON.parse(new TextDecoder().decode(res.body)) as HubRunDetail;
}
