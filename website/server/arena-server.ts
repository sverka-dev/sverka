/**
 * Sverka Arena Server — CRUD API for benchmark cases + static file serving.
 *
 * Endpoints:
 *   GET    /api/cases              — list all cases
 *   GET    /api/cases/:id          — get one case
 *   POST   /api/cases              — create a new case
 *   PUT    /api/cases/:id          — update a case
 *   DELETE /api/cases/:id          — delete a case
 *   GET    /api/config             — get arena config (models, plugins)
 *   PUT    /api/config             — update arena config
 *   GET    /api/results            — get latest results
 *   POST   /api/run                — trigger a benchmark run (async)
 *   GET    /api/run/:id            — get run status
 *
 * Static files: everything else is served from the public directory.
 */

import { serve, type Server } from "bun";
import { readFile, writeFile, mkdir, exists } from "node:fs/promises";
import { join, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const PUBLIC_DIR = fileURLToPath(new URL("../public/benchmark/", import.meta.url));
const DATA_DIR = join(PUBLIC_DIR, "api");
const CASES_FILE = join(DATA_DIR, "cases.json");
const CONFIG_FILE = join(DATA_DIR, "config.json");
const RUNS_DIR = join(DATA_DIR, "runs");

await mkdir(DATA_DIR, { recursive: true });
await mkdir(RUNS_DIR, { recursive: true });

// ─── Types ───────────────────────────────────────────────────────────

interface CaseDefinition {
  id: string;
  name: string;
  prompt: string;
  successCriteria?: string;
  fixture?: string;
  timeoutMs?: number;
  checks?: Array<{ id: string; command: string; description: string }>;
  createdAt: string;
  updatedAt: string;
}

interface ArenaConfig {
  models: Array<{ id: string; name: string; envVar?: string }>;
  plugins: Array<{ id: string; name: string; path: string }>;
  judge?: {
    model: string;
    revealPlugins: boolean;
    repetitions: number;
  };
  repetitions: number;
}

// ─── Storage helpers ─────────────────────────────────────────────────

async function loadCases(): Promise<CaseDefinition[]> {
  if (!(await exists(CASES_FILE))) return [];
  const data = await readFile(CASES_FILE, "utf-8");
  return JSON.parse(data) as CaseDefinition[];
}

async function saveCases(cases: CaseDefinition[]): Promise<void> {
  await writeFile(CASES_FILE, JSON.stringify(cases, null, 2), "utf-8");
}

async function loadConfig(): Promise<ArenaConfig> {
  if (!(await exists(CONFIG_FILE))) {
    return {
      models: [{ id: "glm-5-2", name: "GLM-5.2 High" }],
      plugins: [],
      repetitions: 1,
    };
  }
  const data = await readFile(CONFIG_FILE, "utf-8");
  return JSON.parse(data) as ArenaConfig;
}

async function saveConfig(config: ArenaConfig): Promise<void> {
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

// ─── HTTP helpers ────────────────────────────────────────────────────

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function error(status: number, message: string): Response {
  return json(status, { error: message });
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("Invalid JSON in request body");
  }
}

// ─── Static file serving ─────────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

async function serveStatic(path: string): Promise<Response> {
  // Prevent path traversal: resolve to absolute and verify it stays under PUBLIC_DIR
  const filePath = resolve(PUBLIC_DIR, path.replace(/^[/\\]+/, ""));
  if (!filePath.startsWith(PUBLIC_DIR + sep) && filePath !== PUBLIC_DIR) {
    return error(403, "Forbidden");
  }

  if (!(await exists(filePath))) {
    return error(404, "Not found");
  }

  // Directory? Try index.html
  const stat = await Bun.file(filePath);
  if (stat.size === 0 && !extname(filePath)) {
    const indexPath = join(filePath, "index.html");
    if (await exists(indexPath)) {
      const content = await readFile(indexPath);
      return new Response(content, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
  }

  const content = await readFile(filePath);
  const ext = extname(filePath);
  const mime = MIME_TYPES[ext] ?? "application/octet-stream";
  return new Response(content, {
    headers: { "Content-Type": mime },
  });
}

// ─── API: Cases CRUD ─────────────────────────────────────────────────

async function listCases(): Promise<Response> {
  const cases = await loadCases();
  return json(200, cases);
}

async function getCase(id: string): Promise<Response> {
  const cases = await loadCases();
  const found = cases.find((c) => c.id === id);
  if (!found) return error(404, `Case '${id}' not found`);
  return json(200, found);
}

async function createCase(req: Request): Promise<Response> {
  const body = await readBody(req);
  const id = body.id as string;
  if (!id || !/^[a-z0-9-]+$/.test(id)) {
    return error(400, "id is required and must be lowercase kebab-case");
  }
  if (!body.name) return error(400, "name is required");
  if (!body.prompt) return error(400, "prompt is required");

  const cases = await loadCases();
  if (cases.some((c) => c.id === id)) {
    return error(409, `Case '${id}' already exists`);
  }

  const now = new Date().toISOString();
  const caseDef: CaseDefinition = {
    id,
    name: body.name as string,
    prompt: body.prompt as string,
    successCriteria: body.successCriteria as string | undefined,
    fixture: body.fixture as string | undefined,
    timeoutMs: body.timeoutMs as number | undefined,
    checks: body.checks as CaseDefinition["checks"],
    createdAt: now,
    updatedAt: now,
  };

  cases.push(caseDef);
  await saveCases(cases);
  return json(201, caseDef);
}

async function updateCase(id: string, req: Request): Promise<Response> {
  const body = await readBody(req);
  const cases = await loadCases();
  const idx = cases.findIndex((c) => c.id === id);
  if (idx === -1) return error(404, `Case '${id}' not found`);

  const existing = cases[idx]!;
  const updated: CaseDefinition = {
    ...existing,
    name: (body.name as string) ?? existing.name,
    prompt: (body.prompt as string) ?? existing.prompt,
    successCriteria: (body.successCriteria as string) ?? existing.successCriteria,
    fixture: (body.fixture as string) ?? existing.fixture,
    timeoutMs: (body.timeoutMs as number) ?? existing.timeoutMs,
    checks: (body.checks as CaseDefinition["checks"]) ?? existing.checks,
    updatedAt: new Date().toISOString(),
  };

  cases[idx] = updated;
  await saveCases(cases);
  return json(200, updated);
}

async function deleteCase(id: string): Promise<Response> {
  const cases = await loadCases();
  const idx = cases.findIndex((c) => c.id === id);
  if (idx === -1) return error(404, `Case '${id}' not found`);
  cases.splice(idx, 1);
  await saveCases(cases);
  return json(200, { deleted: id });
}

// ─── API: Config ─────────────────────────────────────────────────────

async function getConfig(): Promise<Response> {
  const config = await loadConfig();
  return json(200, config);
}

async function updateConfig(req: Request): Promise<Response> {
  const body = await readBody(req);
  const config = await loadConfig();
  const updated: ArenaConfig = {
    ...config,
    models: (body.models as ArenaConfig["models"]) ?? config.models,
    plugins: (body.plugins as ArenaConfig["plugins"]) ?? config.plugins,
    judge: (body.judge as ArenaConfig["judge"]) ?? config.judge,
    repetitions: (body.repetitions as number) ?? config.repetitions,
  };
  await saveConfig(updated);
  return json(200, updated);
}

// ─── API: Run ────────────────────────────────────────────────────────

interface RunStatus {
  id: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  error?: string;
  resultsPath?: string;
}

async function startRun(req: Request): Promise<Response> {
  const body = await readBody(req);
  const runId = `run-${Date.now()}`;
  const statusFile = join(RUNS_DIR, `${runId}.json`);

  const status: RunStatus = {
    id: runId,
    status: "running",
    startedAt: new Date().toISOString(),
  };
  await writeFile(statusFile, JSON.stringify(status, null, 2), "utf-8");

  // Spawn the arena runner in the background.
  const caseIds = (body.caseIds as string[]) ?? [];
  const args = ["run", "--output", join(RUNS_DIR, `${runId}-results.json`)];
  if (caseIds.length > 0) {
    args.push("--cases", caseIds.join(","));
  }

  const proc = spawn("bun", ["run", "packages/arena/src/bin.ts", ...args], {
    cwd: process.cwd(),
    stdio: "pipe",
    env: { ...process.env },
  });

  proc.on("close", async (code) => {
    const finalStatus: RunStatus = {
      ...status,
      status: code === 0 ? "completed" : "failed",
      completedAt: new Date().toISOString(),
      resultsPath: join(RUNS_DIR, `${runId}-results.json`),
      error: code !== 0 ? `Process exited with code ${code}` : undefined,
    };
    await writeFile(statusFile, JSON.stringify(finalStatus, null, 2), "utf-8");
  });

  return json(202, status);
}

async function getRunStatus(runId: string): Promise<Response> {
  const statusFile = join(RUNS_DIR, `${runId}.json`);
  if (!(await exists(statusFile))) {
    return error(404, `Run '${runId}' not found`);
  }
  const data = await readFile(statusFile, "utf-8");
  return json(200, JSON.parse(data));
}

// ─── Router ──────────────────────────────────────────────────────────

async function route(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // API routes
  if (path === "/api/cases") {
    if (method === "GET") return listCases();
    if (method === "POST") return createCase(req);
    return error(405, "Method not allowed");
  }

  if (path.startsWith("/api/cases/")) {
    const id = path.substring("/api/cases/".length);
    if (method === "GET") return getCase(id);
    if (method === "PUT") return updateCase(id, req);
    if (method === "DELETE") return deleteCase(id);
    return error(405, "Method not allowed");
  }

  if (path === "/api/config") {
    if (method === "GET") return getConfig();
    if (method === "PUT") return updateConfig(req);
    return error(405, "Method not allowed");
  }

  if (path === "/api/run") {
    if (method === "POST") return startRun(req);
    return error(405, "Method not allowed");
  }

  if (path.startsWith("/api/run/")) {
    const runId = path.substring("/api/run/".length);
    if (method === "GET") return getRunStatus(runId);
    return error(405, "Method not allowed");
  }

  if (path.startsWith("/api/")) {
    return error(404, "API endpoint not found");
  }

  // Static files
  return serveStatic(path === "/" ? "index.html" : path);
}

// ─── Server ──────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 8099);

const server: Server = serve({
  port: PORT,
  fetch: (req) => route(req).catch((err) => {
    console.error("[arena-server] error:", err);
    return error(500, err instanceof Error ? err.message : String(err));
  }),
});

console.log(`[arena-server] listening on http://localhost:${PORT}`);
console.log(`[arena-server] serving from ${PUBLIC_DIR}`);
console.log(`[arena-server] API: /api/cases, /api/config, /api/run`);

export { server };
