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
  open,
  readdir,
  readlink,
  symlink,
  type FileHandle,
} from "node:fs/promises";
import { constants } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { join, dirname, isAbsolute, relative, resolve, sep } from "node:path";
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
  const base = hubBaseUrl(config);
  const connectMs = config.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const bodyMs = config.bodyTimeoutMs ?? DEFAULT_BODY_TIMEOUT_MS;
  // One controller for both phases: headers arrive only after an upload
  // has fully streamed, and aborting it is the only way to cancel a slow
  // body read — a detached timer would leave the stream running.
  const ac = new AbortController();
  const init: RequestInit = { method, signal: ac.signal };
  const headers: Record<string, string> = {
    // codeql[js/file-access-to-http]
    authorization: `Bearer ${config.token}`,
  };
  if (body !== undefined) headers["content-type"] = contentType;
  // Packed workspace files flowing into the request body is this
  // adapter's purpose (hub upload). The base URL is user config — this
  // adapter IS the configured remote — scheme-validated http(s) above.
  // codeql[js/file-access-to-http]
  init.headers = headers;
  if (body !== undefined) {
    // codeql[js/file-access-to-http]
    init.body = body;
  }
  const reqUrl = new URL(path.replace(/^\/+/, ""), base);
  let res: Response;
  try {
    // Uploads get the body budget (headers arrive after the blob
    // streams); requests without a body get the connect budget.
    const firstMs = body !== undefined ? bodyMs : connectMs;
    // codeql[js/file-access-to-http]
    res = await withAbortOnTimeout(
      // codeql[js/file-access-to-http]
      fetch(reqUrl, init), // nosemgrep
      firstMs,
      ac,
      `connect/upload timeout after ${firstMs}ms`,
    );
  } catch (e) {
    throw new HubError(
      "REMOTE_UNAVAILABLE",
      `hub unreachable (${method} ${path}): ${e instanceof Error ? e.message : String(e)}`,
      e,
    );
  }
  // A 401/403 trips the breaker — later requests skip the network.
  if (
    config.circuit !== undefined &&
    (res.status === 401 || res.status === 403)
  ) {
    config.circuit.authFailed = true;
  }
  // Response headers arrived — the body gets its own, longer budget.
  try {
    const buf = new Uint8Array(
      await withAbortOnTimeout(
        res.arrayBuffer(),
        bodyMs,
        ac,
        `body timeout after ${bodyMs}ms`,
      ),
    );
    return { status: res.status, headers: res.headers, body: buf };
  } catch (e) {
    throw new HubError(
      "REMOTE_UNAVAILABLE",
      `hub body read failed (${method} ${path}): ${e instanceof Error ? e.message : String(e)}`,
      e,
    );
  }
}

/** Race a promise against a timeout that aborts `ac` — the abort (not a
 *  detached rejection) is what cancels the in-flight request or stream.
 *  The timer itself is cancelled once the promise settles. */
async function withAbortOnTimeout<T>(
  promise: Promise<T>,
  ms: number,
  ac: AbortController,
  message: string,
): Promise<T> {
  const cancel = new AbortController();
  const armed = delay(ms, undefined, { signal: cancel.signal }).then(() => {
    const e = new DOMException(message, "TimeoutError");
    ac.abort(e);
    throw e;
  });
  try {
    return await Promise.race([promise, armed]);
  } finally {
    cancel.abort();
  }
}

/** The configured hub base as a URL — http(s) only. Anything else
 *  (file:, ws:, a bare hostname) is a config error, not a request
 *  failure, so it fails before the network is touched. */
function hubBaseUrl(config: RemoteStoreConfig): URL {
  let url: URL;
  try {
    url = new URL(config.url);
  } catch (e) {
    throw new HubError(
      "REMOTE_UNAVAILABLE",
      `invalid hub url "${config.url}"`,
      e instanceof Error ? e : undefined,
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HubError(
      "REMOTE_UNAVAILABLE",
      `hub url must be http(s), got ${url.protocol}`,
    );
  }
  // Keep a base-path prefix (hub mounted under a subpath) but make it
  // end in "/" so the route paths below resolve relative to it.
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  url.search = "";
  url.hash = "";
  return url;
}

/** Parse a 2xx body as JSON, keeping the file's contract that every
 *  remote failure surfaces as a HubError (a proxy error page or truncated
 *  body would otherwise escape as a raw SyntaxError). */
function parseJsonBody<T>(res: HubResponse, path: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(res.body)) as T;
  } catch (e) {
    throw new HubError(
      "REMOTE_REJECTED",
      `hub ${path} returned malformed JSON`,
      e,
      res.status,
    );
  }
}

function rejected(method: string, path: string, res: HubResponse): HubError {
  const detail = new TextDecoder().decode(res.body).slice(0, 200);
  const authHint =
    res.status === 401 || res.status === 403
      ? " — run `sverka login` to refresh the hub token"
      : "";
  const detailSuffix = detail === "" ? "" : `: ${detail}`;
  return new HubError(
    "REMOTE_REJECTED",
    `hub ${method} ${path} → ${res.status}${authHint}${detailSuffix}`,
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
  const name = relPath.replaceAll("\\", "/");
  // Classify on an fd when one opens: O_NOFOLLOW fails ELOOP on symlinks,
  // O_NONBLOCK keeps fifos from hanging the open, and stat-ing the opened
  // inode (not the path) removes the lstat→open check-then-act window —
  // the packed bytes are provably the classified inode's. When open itself
  // fails (symlink, socket, unreadable) lstat takes over classification;
  // the path ops those kinds need are the same as before.
  let handle: FileHandle | undefined;
  let openError: unknown;
  try {
    handle = await open(
      abs,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
    );
  } catch (e) {
    openError = e;
  }
  const st = handle !== undefined ? await handle.stat() : await lstat(abs);
  if (st.isFile()) {
    // open failed on a real file (e.g. EACCES) — surface that error,
    // same as opening it here would have.
    if (handle === undefined) {
      throw openError instanceof Error
        ? openError
        : new Error(`cannot open ${abs}`);
    }
    try {
      out.push({
        name,
        type: "file",
        data: new Uint8Array(await handle.readFile()),
        mode: st.mode & 0o777,
        mtime: Math.floor(st.mtimeMs / 1000),
      });
    } finally {
      await handle.close();
    }
    return;
  }
  await handle?.close();
  if (st.isDirectory()) {
    out.push({
      name,
      type: "dir",
      mode: st.mode & 0o777,
      mtime: Math.floor(st.mtimeMs / 1000),
    });
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

/**
 * Reject the entry's parent path when any *existing* ancestor component
 * under targetDir is a symlink (or a non-directory). Writes must never be
 * redirected outside the cache root — a hostile blob could declare a
 * contained symlink first and then write through it, and targetDir may
 * carry links left by an earlier restore.
 *
 * Missing components are fine: mkdir creates them under the verified
 * prefix. (There is an inherent POSIX TOCTOU window between this check
 * and the write; the leaf O_NOFOLLOW narrows it to ancestor components.)
 */
async function assertNoSymlinkAncestors(
  targetDir: string,
  parent: string,
  name: string,
): Promise<void> {
  const rel = relative(targetDir, parent);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new HubError(
      "REMOTE_REJECTED",
      `cache blob entry escapes the target dir: ${name}`,
    );
  }
  if (rel === "") return;
  let cur = targetDir;
  for (const seg of rel.split(sep)) {
    cur = join(cur, seg);
    const st = await lstat(cur).catch(() => undefined);
    if (st === undefined) return; // mkdir will create the rest inside
    if (st.isSymbolicLink() || !st.isDirectory()) {
      throw new HubError(
        "REMOTE_REJECTED",
        `cache blob entry traverses a symlink or non-directory: ${name}`,
      );
    }
  }
}

type ContainedLink = (dest: string, link: string) => boolean;

/** Declared paths the blob actually covers — validated before any write
 *  so a partial entry leaves no half-restored tree. */
function coveredPaths(
  tar: readonly TarEntry[],
  wanted: ReadonlySet<string>,
  targetDir: string,
  containedLink: ContainedLink,
): Set<string> {
  const covered = new Set<string>();
  for (const entry of tar) {
    assertEntryName(entry.name);
    if (
      entry.type === "symlink" &&
      !containedLink(join(targetDir, entry.name), entry.linkname ?? "")
    ) {
      continue;
    }
    for (const p of wanted) {
      if (entry.name === p || entry.name.startsWith(`${p}/`)) {
        covered.add(p);
      }
    }
  }
  return covered;
}

async function extractDirEntry(dest: string, entry: TarEntry): Promise<void> {
  // A leaf symlink would silently redirect later writes — refuse it.
  const st = await lstat(dest).catch(() => undefined);
  if (st?.isSymbolicLink()) {
    throw new HubError(
      "REMOTE_REJECTED",
      `cache blob dir entry collides with a symlink: ${entry.name}`,
    );
  }
  await mkdir(dest, {
    recursive: true,
    ...(entry.mode !== undefined ? { mode: entry.mode } : {}),
  });
}

async function extractFileEntry(dest: string, entry: TarEntry): Promise<void> {
  await mkdir(dirname(dest), { recursive: true });
  // O_NOFOLLOW refuses a leaf symlink — the write cannot be
  // redirected onto an existing link's target. The recorded mode is
  // applied on create so restored executables keep their +x.
  const handle = await open(
    dest,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_TRUNC |
      (constants.O_NOFOLLOW ?? 0),
    entry.mode ?? 0o644,
  );
  try {
    await handle.writeFile(entry.data ?? new Uint8Array());
    // The mode arg only applies on create — an existing file opened with
    // O_TRUNC keeps its permissions, so chmod restores the cached mode.
    if (entry.mode !== undefined) await handle.chmod(entry.mode);
  } finally {
    await handle.close();
  }
}

async function extractEntry(
  targetDir: string,
  wanted: ReadonlySet<string>,
  containedLink: ContainedLink,
  entry: TarEntry,
): Promise<void> {
  if (entry.name === MANIFEST_NAME) return;
  // Only extract declared paths (or children of declared dirs).
  if (
    ![...wanted].some((p) => entry.name === p || entry.name.startsWith(`${p}/`))
  ) {
    return;
  }
  const dest = join(targetDir, entry.name);
  await assertNoSymlinkAncestors(targetDir, dirname(dest), entry.name);
  if (entry.type === "dir") {
    await extractDirEntry(dest, entry);
  } else if (entry.type === "file" && entry.data !== undefined) {
    await extractFileEntry(dest, entry);
  } else if (
    entry.type === "symlink" &&
    entry.linkname !== undefined &&
    containedLink(dest, entry.linkname)
  ) {
    await mkdir(dirname(dest), { recursive: true });
    await symlink(entry.linkname, dest);
  }
}

/**
 * Extract a tar.zst blob's declared paths into targetDir. Returns the set
 * of declared paths that were actually restored — a blob that lacks a
 * declared path is a partial entry and must count as a miss, not a hit
 * (otherwise the engine skips rebuilding outputs that never landed).
 */
async function extractCacheBlob(
  blob: Uint8Array,
  paths: readonly string[],
  targetDir: string,
): Promise<ReadonlySet<string>> {
  const tar = unpackTar(new Uint8Array(zstdDecompressSync(Buffer.from(blob))));
  const wanted = new Set(paths.map((p) => p.replaceAll("\\", "/")));
  const targetRoot = resolve(targetDir);

  // Link targets must stay inside the target dir — a blob that plants a
  // symlink to /etc would escape the cache sandbox. resolve() (not join())
  // so absolute targets fail containment rather than being re-rooted.
  const containedLink = (dest: string, link: string): boolean => {
    if (link === "" || link.startsWith("/") || link.includes("\\")) {
      return false;
    }
    const resolved = resolve(dirname(dest), link);
    return (
      resolved === targetRoot || resolved.startsWith(`${targetRoot}${sep}`)
    );
  };

  // Validate names and coverage up front: a blob missing a declared path
  // (or covering it only with an unwritable entry) is a miss — bail before
  // writing so a partial entry leaves no half-restored tree.
  const covered = coveredPaths(tar, wanted, targetDir, containedLink);
  if (covered.size === wanted.size) {
    for (const entry of tar) {
      await extractEntry(targetDir, wanted, containedLink, entry);
    }
  }
  return covered;
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
      const wanted = new Set(req.paths.map((p) => p.replaceAll("\\", "/")));
      // File-cache semantics: the primary key is exact-only; restoreKeys
      // opt into prefix matching via ?prefix=1 (the hub must not return a
      // different key's blob to an exact-key GET).
      const attempts: { key: string; prefix: boolean }[] = [
        { key: req.key, prefix: false },
        ...req.restoreKeys.map((key) => ({ key, prefix: true })),
      ];
      for (const { key, prefix } of attempts) {
        const path = `${pathFor(key)}${prefix ? "?prefix=1" : ""}`;
        const res = await hubRequest(config, "GET", path);
        if (res.status === 404) continue;
        if (res.status !== 200) throw rejected("GET", pathFor(key), res);
        const covered = await extractCacheBlob(
          res.body,
          req.paths,
          req.targetDir,
        );
        // A blob missing a declared path is a partial entry — treating it
        // as a hit would skip rebuilding outputs that never landed.
        if (covered.size < wanted.size) continue;
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
  const parsed = parseJsonBody<{ runId?: unknown; url?: unknown }>(
    res,
    "POST /v1/runs",
  );
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
  return parseJsonBody<HubRunSummary[]>(res, "GET /v1/runs");
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
  return parseJsonBody<HubRunDetail>(res, `GET /v1/runs/${runId}`);
}
