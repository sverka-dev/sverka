// Self-hosted hub server — node:http, JSON API under /v1/ plus a static
// dashboard from @sverka/ui. Spec 55.

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import {
  renderHubIndex,
  renderHubRunList,
  renderHubRunDetail,
  renderHubFlaky,
} from "@sverka/ui";
import { generateSarifHtml } from "@sverka/sarif-viewer-web";
import type { Finding } from "@sverka/verification";
import type { HubServer, HubServerOptions, HubToken } from "./types.js";
import { resolveTokens, extractToken, tokenEquals } from "./auth.js";
import {
  createHubStore,
  isValidCacheKey,
  isValidRunId,
  type HubStore,
  type RunInsert,
} from "./store.js";

const MAX_BLOB_DEFAULT = 512 * 1024 * 1024;
const MAX_JSON_DEFAULT = 32 * 1024 * 1024;

const API_HEADERS: Record<string, string> = {
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

const PAGE_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  // frame-src 'self' permits the run page's same-origin findings iframe;
  // the SARIF sub-document still gets its own pinned script hashes.
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-src 'self'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
};

const SARIF_PAGE_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' " +
    "'sha256-x9+d/4JxomKClc3VqIk1V6NKTggeahAWBzMe4jvu7Ec=' " +
    "'sha256-SKcdA9aMlus8zeJkaXi1rBBOaGcYgbLddLTB7hCBKm0=' " +
    "'sha256-RHNT17OCv3OqIHedvPQaLavcOKHQd1OiBVo17IqkhXQ='; " +
    "style-src 'unsafe-inline'; img-src 'self' data:",
  "X-Frame-Options": "SAMEORIGIN",
  "X-Content-Type-Options": "nosniff",
};

const ENC = (s: string) => encodeURIComponent(s);

/** Start the hub server. Resolves once listening. */
export function startHubServer(opts: HubServerOptions): Promise<HubServer> {
  const store = createHubStore(opts.dataDir);
  const { tokens, generated } = resolveTokens(opts.dataDir, opts.tokens);
  if (generated !== null) {
    console.log(`sverka hub: generated admin token ${generated.token}`);
    console.log(`  saved to ${opts.dataDir}/tokens`);
  }

  const maxBlob = opts.maxBlobBytes ?? MAX_BLOB_DEFAULT;
  const maxJson = opts.maxJsonBytes ?? MAX_JSON_DEFAULT;

  const server = createServer((req, res) => {
    void handle(req, res, store, tokens, { maxBlob, maxJson }).catch(
      (err: unknown) => {
        if (!res.headersSent) {
          json(res, 500, { code: "INTERNAL", message: "internal error" });
        }
        if (err instanceof Error)
          console.error("hub request failed:", err.message);
      },
    );
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(opts.port ?? 7357, opts.host ?? "0.0.0.0", () => {
      const addr = server.address() as AddressInfo;
      const url =
        addr.family === "IPv6"
          ? `http://[${addr.address}]:${addr.port}`
          : `http://${addr.address}:${addr.port}`;
      resolve({
        port: addr.port,
        url,
        dataDir: opts.dataDir,
        close: () => closeServer(server, store),
      });
    });
  });
}

function closeServer(server: Server, store: HubStore): Promise<void> {
  return new Promise<void>((done) => {
    // Drain in-flight requests before closing the SQLite index — closing
    // the store first would fail requests still reading their bodies.
    server.close(() => {
      store.close();
      done();
    });
  });
}

interface Limits {
  maxBlob: number;
  maxJson: number;
}

type Access = "ro" | "rw";

interface ReqCtx {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly store: HubStore;
  readonly url: URL;
  readonly method: string;
  readonly path: string;
  readonly limits: Limits;
}

/** Route handler: returns true when it answered the request. */
type Route = (ctx: ReqCtx) => boolean | Promise<boolean>;

const ROUTES: readonly Route[] = [
  cacheRoute,
  snapshotRoute,
  runsRoute,
  runRoute,
  flakyApiRoute,
  indexRoute,
  findingsPageRoute,
  runPageRoute,
  flakyPageRoute,
];

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  store: HubStore,
  tokens: readonly HubToken[],
  limits: Limits,
): Promise<void> {
  // The base is a parse placeholder only — never used on the wire.
  const url = new URL(req.url ?? "/", "https://hub.invalid");
  const ctx: ReqCtx = {
    req,
    res,
    store,
    url,
    method: req.method ?? "GET",
    path: url.pathname,
    limits,
  };

  // Health check is unauthenticated.
  if (ctx.path === "/v1/ping") {
    if (ctx.method === "GET") {
      json(res, 200, { status: "ok" });
    } else {
      methodNotAllowed(res);
    }
    return;
  }

  // Everything else needs a token.
  const auth = authenticate(req, url.searchParams, tokens, res);
  if (auth === null) return;
  const requireWrite = ctx.method !== "GET" && ctx.method !== "HEAD";
  if (requireWrite && auth.access !== "rw") {
    json(res, 403, { code: "READ_ONLY", message: "token is read-only" });
    return;
  }
  promoteQueryToken(ctx, auth);

  for (const route of ROUTES) {
    if (await route(ctx)) return;
  }
  json(res, 404, { code: "NOT_FOUND", message: "unknown route" });
}

// --- /v1 routes ---

async function cacheRoute(ctx: ReqCtx): Promise<boolean> {
  const m = match2(ctx.path, /^\/v1\/cache\/([^/]+)\/([^/]+)$/);
  if (m === null) return false;
  const [project, key] = m;
  if (!isValidCacheKey(key)) {
    json(ctx.res, 400, { code: "BAD_KEY", message: "invalid cache key" });
    return true;
  }
  if (ctx.method === "PUT") {
    const body = await readBody(ctx.req, ctx.limits.maxBlob, ctx.res);
    if (body === null) return true;
    ctx.store.putBlob(project, key, body);
    ctx.res.writeHead(201, API_HEADERS);
    ctx.res.end();
    return true;
  }
  if (ctx.method === "GET") {
    // Prefix matching is opt-in (?prefix=1) — it's the restoreKeys
    // semantic. An exact-key GET must never return a different key's
    // blob, and misses stay O(1) instead of scanning the blob dir.
    const hit = ctx.store.getBlob(project, key, {
      prefix: ctx.url.searchParams.get("prefix") === "1",
    });
    if (hit === undefined) {
      json(ctx.res, 404, {
        code: "NOT_FOUND",
        message: "cache entry not found",
      });
      return true;
    }
    ctx.res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "x-sverka-cache-key": hit.key,
      "X-Content-Type-Options": "nosniff",
    });
    ctx.res.end(hit.blob);
    return true;
  }
  methodNotAllowed(ctx.res);
  return true;
}

async function snapshotRoute(ctx: ReqCtx): Promise<boolean> {
  const m = match2(ctx.path, /^\/v1\/snapshots\/([^/]+)\/([^/]+)$/);
  if (m === null) return false;
  const [project, runId] = m;
  if (!isValidRunId(runId)) {
    json(ctx.res, 400, { code: "BAD_ID", message: "invalid run id" });
    return true;
  }
  if (ctx.method === "PUT") {
    const body = await readBody(ctx.req, ctx.limits.maxJson, ctx.res);
    if (body === null) return true;
    ctx.store.putSnapshot(project, runId, body.toString("utf8"));
    ctx.res.writeHead(201, API_HEADERS);
    ctx.res.end();
    return true;
  }
  if (ctx.method === "GET") {
    const snap = ctx.store.getSnapshot(project, runId);
    if (snap === undefined) {
      json(ctx.res, 404, { code: "NOT_FOUND", message: "snapshot not found" });
      return true;
    }
    ctx.res.writeHead(200, API_HEADERS);
    ctx.res.end(snap);
    return true;
  }
  if (ctx.method === "DELETE") {
    const existed = ctx.store.deleteSnapshot(project, runId);
    ctx.res.writeHead(existed ? 204 : 404, API_HEADERS);
    ctx.res.end();
    return true;
  }
  methodNotAllowed(ctx.res);
  return true;
}

async function runsRoute(ctx: ReqCtx): Promise<boolean> {
  if (ctx.path !== "/v1/runs") return false;
  if (ctx.method === "POST") {
    const body = await readBody(ctx.req, ctx.limits.maxJson, ctx.res);
    if (body === null) return true;
    const insert = parseRunInsert(body, ctx.res);
    if (insert === null) return true;
    const run = ctx.store.insertRun(insert);
    json(ctx.res, 201, {
      runId: run.runId,
      url: `/v1/runs/${ENC(run.runId)}`,
    });
    return true;
  }
  if (ctx.method === "GET") {
    const runs = ctx.store.listRuns({
      project: ctx.url.searchParams.get("project") ?? undefined,
      limit: numParam(ctx.url, "limit"),
      before: numParam(ctx.url, "before"),
    });
    json(ctx.res, 200, runs.map(runSummary));
    return true;
  }
  methodNotAllowed(ctx.res);
  return true;
}

/** Parse + validate the POST /v1/runs body; writes the 400 itself and
 *  returns null when the payload is unusable. */
function parseRunInsert(body: Buffer, res: ServerResponse): RunInsert | null {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
  } catch {
    json(res, 400, { code: "BAD_JSON", message: "invalid JSON body" });
    return null;
  }
  const { project, entry, report, findings, runId } = payload;
  if (typeof project !== "string" || project === "") {
    return badBody(res, "project required");
  }
  if (typeof entry !== "string" || entry === "") {
    return badBody(res, "entry required");
  }
  if (typeof report !== "object" || report === null) {
    return badBody(res, "report required");
  }
  if (findings !== undefined && !Array.isArray(findings)) {
    return badBody(res, "findings must be an array");
  }
  if (
    runId !== undefined &&
    (typeof runId !== "string" || !isValidRunId(runId))
  ) {
    json(res, 400, { code: "BAD_ID", message: "invalid run id" });
    return null;
  }
  return {
    project,
    entry,
    report: report as Record<string, unknown>,
    findings: (findings as readonly unknown[] | undefined) ?? [],
    runId: runId as string | undefined,
  };
}

function badBody(res: ServerResponse, message: string): null {
  json(res, 400, { code: "BAD_BODY", message });
  return null;
}

function runRoute(ctx: ReqCtx): boolean {
  const runId = match1(ctx.path, /^\/v1\/runs\/([^/]+)$/);
  if (runId === null) return false;
  if (ctx.method === "GET") {
    const run = ctx.store.getRun(runId);
    if (run === undefined) {
      json(ctx.res, 404, { code: "NOT_FOUND", message: "run not found" });
      return true;
    }
    json(ctx.res, 200, {
      ...runSummary(run),
      report: JSON.parse(run.reportJson) as unknown,
      findings: JSON.parse(run.findingsJson) as unknown,
      uploadedAt: run.uploadedAt,
    });
    return true;
  }
  methodNotAllowed(ctx.res);
  return true;
}

// Flaky-step aggregation.
function flakyApiRoute(ctx: ReqCtx): boolean {
  const project = match1(ctx.path, /^\/v1\/flaky\/([^/]+)$/);
  if (project === null) return false;
  if (ctx.method === "GET") {
    json(ctx.res, 200, {
      rows: ctx.store.flaky(project, {
        n: numParam(ctx.url, "n"),
        steps: csvParam(ctx.url, "steps"),
      }),
    });
    return true;
  }
  methodNotAllowed(ctx.res);
  return true;
}

// --- dashboard (HTML) ---

function indexRoute(ctx: ReqCtx): boolean {
  if (ctx.path !== "/") return false;
  if (ctx.method === "GET") {
    const project = ctx.url.searchParams.get("project");
    if (project === null) {
      page(ctx.res, renderHubIndex({ projects: ctx.store.listProjects() }));
      return true;
    }
    const limit = numParam(ctx.url, "limit") ?? 50;
    const runs = ctx.store.listRuns({ project, limit }).map(runSummary);
    page(ctx.res, renderHubRunList({ project, runs }));
    return true;
  }
  methodNotAllowed(ctx.res);
  return true;
}

function findingsPageRoute(ctx: ReqCtx): boolean {
  const m = match2(ctx.path, /^\/runs\/([^/]+)\/([^/]+)\/findings$/);
  if (m === null) return false;
  if (ctx.method === "GET") {
    const run = ctx.store.getRun(m[1]);
    if (run === undefined || run.project !== m[0]) {
      notFoundPage(ctx.res);
      return true;
    }
    const findings = JSON.parse(run.findingsJson) as Finding[];
    ctx.res.writeHead(200, SARIF_PAGE_HEADERS);
    ctx.res.end(generateSarifHtml(findings));
    return true;
  }
  methodNotAllowed(ctx.res);
  return true;
}

function runPageRoute(ctx: ReqCtx): boolean {
  const m = match2(ctx.path, /^\/runs\/([^/]+)\/([^/]+)$/);
  if (m === null) return false;
  if (ctx.method === "GET") {
    const run = ctx.store.getRun(m[1]);
    if (run === undefined || run.project !== m[0]) {
      notFoundPage(ctx.res);
      return true;
    }
    page(
      ctx.res,
      renderHubRunDetail({
        run: {
          ...runSummary(run),
          report: JSON.parse(run.reportJson) as Record<string, unknown>,
          findings: JSON.parse(run.findingsJson) as readonly unknown[],
          uploadedAt: run.uploadedAt,
        },
      }),
    );
    return true;
  }
  methodNotAllowed(ctx.res);
  return true;
}

function flakyPageRoute(ctx: ReqCtx): boolean {
  const project = match1(ctx.path, /^\/flaky\/([^/]+)$/);
  if (project === null) return false;
  if (ctx.method === "GET") {
    const window = numParam(ctx.url, "n") ?? 20;
    page(
      ctx.res,
      renderHubFlaky({
        project,
        rows: ctx.store.flaky(project, { n: window }),
        window,
      }),
    );
    return true;
  }
  methodNotAllowed(ctx.res);
  return true;
}

// --- shared helpers ---

// A valid ?token= promotes to a cookie so dashboard links work.
// Secure only when the request actually arrived over TLS — the hub
// serves plain HTTP by default (a Secure cookie would never stick);
// behind a TLS-terminating proxy x-forwarded-proto applies.
function promoteQueryToken(
  ctx: ReqCtx,
  auth: { token: string; viaQuery: boolean },
): void {
  if (!auth.viaQuery || ctx.method !== "GET") return;
  const tls =
    (ctx.req.socket as { encrypted?: boolean }).encrypted === true ||
    headerValue(ctx.req.headers["x-forwarded-proto"])?.split(",")[0]?.trim() ===
      "https";
  ctx.res.setHeader(
    "Set-Cookie",
    `hub_token=${encodeURIComponent(auth.token)}; HttpOnly;${tls ? " Secure;" : ""} SameSite=Strict; Path=/`,
  );
}

/** Numeric query param — absent or non-finite becomes undefined. */
function numParam(url: URL, name: string): number | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Comma-separated query param — absent or empty becomes undefined. */
function csvParam(url: URL, name: string): string[] | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === "") return undefined;
  return raw.split(",").filter((s) => s !== "");
}

/** URL-decode a single path segment matched by `pattern`'s 1st group. */
function match1(path: string, pattern: RegExp): string | null {
  const m = pattern.exec(path);
  const seg = m?.[1];
  if (seg === undefined) return null;
  try {
    return decodeURIComponent(seg);
  } catch {
    return null;
  }
}

/** URL-decode two path segments from `pattern`'s capture groups. */
function match2(path: string, pattern: RegExp): [string, string] | null {
  const m = pattern.exec(path);
  const [a, b] = [m?.[1], m?.[2]];
  if (a === undefined || b === undefined) return null;
  try {
    return [decodeURIComponent(a), decodeURIComponent(b)];
  } catch {
    return null;
  }
}

function authenticate(
  req: IncomingMessage,
  query: URLSearchParams,
  tokens: readonly HubToken[],
  res: ServerResponse,
): { token: string; access: Access; viaQuery: boolean } | null {
  const { token, viaQuery } = extractToken(
    {
      headers: {
        authorization: headerValue(req.headers["authorization"]),
        cookie: headerValue(req.headers["cookie"]),
      },
    },
    query,
  );
  if (!token) {
    json(res, 401, { code: "UNAUTHORIZED", message: "token required" });
    return null;
  }
  const found = tokens.find((t) => tokenEquals(t.token, token));
  if (found === undefined) {
    json(res, 401, { code: "UNAUTHORIZED", message: "invalid token" });
    return null;
  }
  return { token, access: found.access, viaQuery };
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Read a request body up to `cap` bytes; 413 + null when exceeded. */
function readBody(
  req: IncomingMessage,
  cap: number,
  res: ServerResponse,
): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on("data", (chunk: Buffer) => {
      // After the 413 the request is destroyed, but already-buffered
      // chunks still reach this listener — bail before they can trigger
      // a second response (ERR_HTTP_HEADERS_SENT) or grow `chunks`.
      if (done) return;
      size += chunk.length;
      if (size > cap) {
        done = true;
        json(res, 413, { code: "TOO_LARGE", message: "payload too large" });
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!done) resolve(Buffer.concat(chunks));
    });
    req.on("error", () => {
      if (!done) resolve(null);
    });
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, API_HEADERS);
  res.end(JSON.stringify(body));
}

function methodNotAllowed(res: ServerResponse): void {
  json(res, 405, {
    code: "METHOD_NOT_ALLOWED",
    message: "method not allowed on this route",
  });
}

function page(res: ServerResponse, html: string): void {
  res.writeHead(200, PAGE_HEADERS);
  // Every user-controlled value that reaches these pages is escaped by
  // escapeHtml() in @sverka/ui's render functions; CSP default-src 'none'
  // is the backstop when anything slips through.
  res.end(html); // codeql[js/reflected-xss]
}

function notFoundPage(res: ServerResponse): void {
  res.writeHead(404, PAGE_HEADERS);
  res.end("<h1>404 — not found</h1>");
}

interface FindingCounts {
  readonly total: number;
  readonly bySeverity: Record<string, number>;
}

function parseCounts(json: string): FindingCounts {
  try {
    const parsed = JSON.parse(json) as Partial<FindingCounts>;
    return {
      total: typeof parsed.total === "number" ? parsed.total : 0,
      bySeverity:
        typeof parsed.bySeverity === "object" && parsed.bySeverity !== null
          ? parsed.bySeverity
          : {},
    };
  } catch {
    return { total: 0, bySeverity: {} };
  }
}

function runSummary(run: {
  runId: string;
  project: string;
  entry: string;
  status: string;
  startedAt: number | null;
  durationMs: number | null;
  findingCounts: string;
  policyVerdict: string | null;
}) {
  return {
    runId: run.runId,
    project: run.project,
    entry: run.entry,
    status: run.status,
    startedAt: run.startedAt,
    durationMs: run.durationMs,
    findingCounts: parseCounts(run.findingCounts),
    policyVerdict: run.policyVerdict,
  };
}
