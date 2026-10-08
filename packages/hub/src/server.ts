// Self-hosted hub server — node:http, JSON API under /v1/ plus a static
// dashboard from @sverka/ui. Spec 55.

import {
  createServer,
  type IncomingMessage,
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
} from "./store.js";

const MAX_BLOB_DEFAULT = 512 * 1024 * 1024;
const MAX_JSON_DEFAULT = 32 * 1024 * 1024;

const API_HEADERS: Record<string, string> = {
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

const PAGE_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'",
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
        close: () =>
          new Promise<void>((done) => {
            store.close();
            server.close(() => done());
          }),
      });
    });
  });
}

interface Limits {
  maxBlob: number;
  maxJson: number;
}

type Access = "ro" | "rw";

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  store: HubStore,
  tokens: readonly HubToken[],
  limits: Limits,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://hub.invalid");
  const method = req.method ?? "GET";
  const path = url.pathname;

  // Health check is unauthenticated.
  if (path === "/v1/ping" && method === "GET") {
    json(res, 200, { status: "ok" });
    return;
  }

  // Everything else needs a token.
  const auth = authenticate(req, url.searchParams, tokens, res);
  if (auth === null) return;
  const requireWrite = method !== "GET" && method !== "HEAD";
  if (requireWrite && auth.access !== "rw") {
    json(res, 403, { code: "READ_ONLY", message: "token is read-only" });
    return;
  }
  // A valid ?token= promotes to a cookie so dashboard links work.
  if (auth.viaQuery && method === "GET") {
    res.setHeader(
      "Set-Cookie",
      `hub_token=${encodeURIComponent(auth.token)}; HttpOnly; SameSite=Strict; Path=/`,
    );
  }

  // Cache blobs.
  const cacheMatch = match2(path, /^\/v1\/cache\/([^/]+)\/([^/]+)$/);
  if (cacheMatch !== null) {
    const [project, key] = cacheMatch;
    if (!isValidCacheKey(key)) {
      json(res, 400, { code: "BAD_KEY", message: "invalid cache key" });
      return;
    }
    if (method === "PUT") {
      const body = await readBody(req, limits.maxBlob, res);
      if (body === null) return;
      store.putBlob(project, key, body);
      res.writeHead(201, API_HEADERS);
      res.end();
      return;
    }
    if (method === "GET") {
      const hit = store.getBlob(project, key);
      if (hit === undefined) {
        json(res, 404, { code: "NOT_FOUND", message: "cache entry not found" });
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "x-sverka-cache-key": hit.key,
        "X-Content-Type-Options": "nosniff",
      });
      res.end(hit.blob);
      return;
    }
  }

  // Snapshots.
  const snapMatch = match2(path, /^\/v1\/snapshots\/([^/]+)\/([^/]+)$/);
  if (snapMatch !== null) {
    const [project, runId] = snapMatch;
    if (!isValidRunId(runId)) {
      json(res, 400, { code: "BAD_ID", message: "invalid run id" });
      return;
    }
    if (method === "PUT") {
      const body = await readBody(req, limits.maxJson, res);
      if (body === null) return;
      store.putSnapshot(project, runId, body.toString("utf8"));
      res.writeHead(201, API_HEADERS);
      res.end();
      return;
    }
    if (method === "GET") {
      const snap = store.getSnapshot(project, runId);
      if (snap === undefined) {
        json(res, 404, { code: "NOT_FOUND", message: "snapshot not found" });
        return;
      }
      res.writeHead(200, API_HEADERS);
      res.end(snap);
      return;
    }
    if (method === "DELETE") {
      const existed = store.deleteSnapshot(project, runId);
      res.writeHead(existed ? 204 : 404, API_HEADERS);
      res.end();
      return;
    }
  }

  // Runs.
  if (path === "/v1/runs") {
    if (method === "POST") {
      const body = await readBody(req, limits.maxJson, res);
      if (body === null) return;
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
      } catch {
        json(res, 400, { code: "BAD_JSON", message: "invalid JSON body" });
        return;
      }
      const { project, entry, report, findings, runId } = payload as {
        project?: unknown;
        entry?: unknown;
        report?: unknown;
        findings?: unknown;
        runId?: unknown;
      };
      if (typeof project !== "string" || project === "") {
        json(res, 400, { code: "BAD_BODY", message: "project required" });
        return;
      }
      if (typeof entry !== "string" || entry === "") {
        json(res, 400, { code: "BAD_BODY", message: "entry required" });
        return;
      }
      if (typeof report !== "object" || report === null) {
        json(res, 400, { code: "BAD_BODY", message: "report required" });
        return;
      }
      if (findings !== undefined && !Array.isArray(findings)) {
        json(res, 400, {
          code: "BAD_BODY",
          message: "findings must be an array",
        });
        return;
      }
      if (
        runId !== undefined &&
        (typeof runId !== "string" || !isValidRunId(runId))
      ) {
        json(res, 400, { code: "BAD_ID", message: "invalid run id" });
        return;
      }
      const run = store.insertRun({
        project,
        entry,
        report: report as Record<string, unknown>,
        findings: (findings as readonly unknown[] | undefined) ?? [],
        runId: runId as string | undefined,
      });
      json(res, 201, { runId: run.runId, url: `/v1/runs/${ENC(run.runId)}` });
      return;
    }
    if (method === "GET") {
      const project = url.searchParams.get("project") ?? undefined;
      const limitRaw = url.searchParams.get("limit");
      const beforeRaw = url.searchParams.get("before");
      const limit = limitRaw === null ? undefined : Number(limitRaw);
      const before = beforeRaw === null ? undefined : Number(beforeRaw);
      const runs = store.listRuns({
        project,
        limit:
          limit !== undefined && Number.isFinite(limit) ? limit : undefined,
        before:
          before !== undefined && Number.isFinite(before) ? before : undefined,
      });
      json(res, 200, runs.map(runSummary));
      return;
    }
  }

  const runIdSeg = match1(path, /^\/v1\/runs\/([^/]+)$/);
  if (runIdSeg !== null && method === "GET") {
    const run = store.getRun(runIdSeg);
    if (run === undefined) {
      json(res, 404, { code: "NOT_FOUND", message: "run not found" });
      return;
    }
    json(res, 200, {
      ...runSummary(run),
      report: JSON.parse(run.reportJson) as unknown,
      findings: JSON.parse(run.findingsJson) as unknown,
      uploadedAt: run.uploadedAt,
    });
    return;
  }

  // Flaky-step aggregation.
  const flakySeg = match1(path, /^\/v1\/flaky\/([^/]+)$/);
  if (flakySeg !== null && method === "GET") {
    const stepsParam = url.searchParams.get("steps");
    const nRaw = url.searchParams.get("n");
    const n = nRaw === null ? undefined : Number(nRaw);
    const steps =
      stepsParam === null || stepsParam === ""
        ? undefined
        : stepsParam.split(",").filter((s) => s !== "");
    json(res, 200, {
      rows: store.flaky(flakySeg, {
        n: n !== undefined && Number.isFinite(n) ? n : undefined,
        steps,
      }),
    });
    return;
  }

  // --- dashboard (HTML) ---

  if (path === "/" && method === "GET") {
    const project = url.searchParams.get("project");
    if (project === null) {
      page(res, renderHubIndex({ projects: store.listProjects() }));
      return;
    }
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw === null ? 50 : Number(limitRaw);
    const runs = store
      .listRuns({
        project,
        limit: Number.isFinite(limit) ? limit : 50,
      })
      .map(runSummary);
    page(res, renderHubRunList({ project, runs }));
    return;
  }

  const findingsMatch = match2(path, /^\/runs\/([^/]+)\/([^/]+)\/findings$/);
  if (findingsMatch !== null && method === "GET") {
    const run = store.getRun(findingsMatch[1]);
    if (run === undefined || run.project !== findingsMatch[0]) {
      notFoundPage(res);
      return;
    }
    const findings = JSON.parse(run.findingsJson) as Finding[];
    res.writeHead(200, SARIF_PAGE_HEADERS);
    res.end(generateSarifHtml(findings));
    return;
  }

  const runPageMatch = match2(path, /^\/runs\/([^/]+)\/([^/]+)$/);
  if (runPageMatch !== null && method === "GET") {
    const run = store.getRun(runPageMatch[1]);
    if (run === undefined || run.project !== runPageMatch[0]) {
      notFoundPage(res);
      return;
    }
    page(
      res,
      renderHubRunDetail({
        run: {
          ...runSummary(run),
          report: JSON.parse(run.reportJson) as Record<string, unknown>,
          findings: JSON.parse(run.findingsJson) as readonly unknown[],
          uploadedAt: run.uploadedAt,
        },
      }),
    );
    return;
  }

  const flakyPageSeg = match1(path, /^\/flaky\/([^/]+)$/);
  if (flakyPageSeg !== null && method === "GET") {
    const nRaw = url.searchParams.get("n");
    const n = nRaw === null ? 20 : Number(nRaw);
    const window = Number.isFinite(n) ? n : 20;
    page(
      res,
      renderHubFlaky({
        project: flakyPageSeg,
        rows: store.flaky(flakyPageSeg, { n: window }),
        window,
      }),
    );
    return;
  }

  json(res, 404, { code: "NOT_FOUND", message: "unknown route" });
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
  if (token === null) {
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
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > cap) {
        json(res, 413, { code: "TOO_LARGE", message: "payload too large" });
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", () => resolve(null));
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, API_HEADERS);
  res.end(JSON.stringify(body));
}

function page(res: ServerResponse, html: string): void {
  res.writeHead(200, PAGE_HEADERS);
  res.end(html);
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
