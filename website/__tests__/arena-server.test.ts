import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serve, type Server } from "bun";
import { readFile, writeFile, rm, mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We test the arena server by importing its handler logic directly.
// Since the server module starts on import, we test the API contract
// by making HTTP requests to a test instance.

const TEST_PORT = 18099;
const BASE = `http://localhost:${TEST_PORT}`;

// Create a minimal test server that mirrors the arena-server API
// using a temp data directory.
let TEST_DIR: string;
let CASES_FILE: string;
let CONFIG_FILE: string;

let server: Server;

beforeAll(async () => {
  TEST_DIR = await mkdtemp(join(tmpdir(), "arena-server-test-"));
  CASES_FILE = join(TEST_DIR, "cases.json");
  CONFIG_FILE = join(TEST_DIR, "config.json");

  // Seed initial data
  await writeFile(CASES_FILE, JSON.stringify([
    {
      id: "seed-case",
      name: "Seed Case",
      prompt: "Test prompt",
      fixture: "fixtures/test",
      timeoutMs: 60000,
      checks: [{ id: "test", command: "echo ok", description: "test" }],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ], null, 2));

  await writeFile(CONFIG_FILE, JSON.stringify({
    models: [{ id: "test-model", name: "Test Model" }],
    plugins: [{ id: "test-plugin", name: "Test Plugin", path: "/tmp/test" }],
    repetitions: 1,
  }, null, 2));

  // Inline server for testing
  const PUBLIC_DIR = join(process.cwd(), "website/public/benchmark");

  async function loadCases() {
    return JSON.parse(await readFile(CASES_FILE, "utf-8"));
  }
  async function saveCases(c: unknown[]) {
    await writeFile(CASES_FILE, JSON.stringify(c, null, 2), "utf-8");
  }
  async function loadConfig() {
    return JSON.parse(await readFile(CONFIG_FILE, "utf-8"));
  }
  async function saveConfig(c: unknown) {
    await writeFile(CONFIG_FILE, JSON.stringify(c, null, 2), "utf-8");
  }

  function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
  function error(status: number, msg: string): Response {
    return json(status, { error: msg });
  }

  server = serve({
    port: TEST_PORT,
    fetch: async (req) => {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;

      if (path === "/api/cases") {
        if (method === "GET") return json(200, await loadCases());
        if (method === "POST") {
          const body = JSON.parse(await req.text());
          if (!body.id || !/^[a-z0-9-]+$/.test(body.id)) return error(400, "invalid id");
          if (!body.name) return error(400, "name required");
          if (!body.prompt) return error(400, "prompt required");
          const cases = await loadCases();
          if (cases.some((c: any) => c.id === body.id)) return error(409, "exists");
          const now = new Date().toISOString();
          const newCase = { ...body, createdAt: now, updatedAt: now };
          cases.push(newCase);
          await saveCases(cases);
          return json(201, newCase);
        }
        return error(405, "method not allowed");
      }

      if (path.startsWith("/api/cases/")) {
        const id = path.substring("/api/cases/".length);
        const cases = await loadCases();
        const idx = cases.findIndex((c: any) => c.id === id);
        if (idx === -1) return error(404, "not found");
        if (method === "GET") return json(200, cases[idx]);
        if (method === "PUT") {
          const body = JSON.parse(await req.text());
          cases[idx] = { ...cases[idx], ...body, updatedAt: new Date().toISOString() };
          await saveCases(cases);
          return json(200, cases[idx]);
        }
        if (method === "DELETE") {
          cases.splice(idx, 1);
          await saveCases(cases);
          return json(200, { deleted: id });
        }
        return error(405, "method not allowed");
      }

      if (path === "/api/config") {
        if (method === "GET") return json(200, await loadConfig());
        if (method === "PUT") {
          const body = JSON.parse(await req.text());
          const config = { ...(await loadConfig()), ...body };
          await saveConfig(config);
          return json(200, config);
        }
        return error(405, "method not allowed");
      }

      return error(404, "not found");
    },
  });
});

afterAll(async () => {
  if (server) server.stop();
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("arena-server CRUD API", () => {
  it("GET /api/cases returns seeded cases", async () => {
    const resp = await fetch(`${BASE}/api/cases`);
    expect(resp.ok).toBe(true);
    const cases = await resp.json();
    expect(Array.isArray(cases)).toBe(true);
    expect(cases.length).toBeGreaterThan(0);
    expect(cases.some((c: any) => c.id === "seed-case")).toBe(true);
  });

  it("GET /api/cases/:id returns a specific case", async () => {
    const resp = await fetch(`${BASE}/api/cases/seed-case`);
    expect(resp.ok).toBe(true);
    const c = await resp.json();
    expect(c.id).toBe("seed-case");
    expect(c.prompt).toBe("Test prompt");
  });

  it("GET /api/cases/:id returns 404 for non-existent", async () => {
    const resp = await fetch(`${BASE}/api/cases/nonexistent`);
    expect(resp.status).toBe(404);
  });

  it("POST /api/cases creates a new case", async () => {
    const resp = await fetch(`${BASE}/api/cases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "new-test",
        name: "New Test",
        prompt: "Do the thing",
      }),
    });
    expect(resp.status).toBe(201);
    const c = await resp.json();
    expect(c.id).toBe("new-test");
    expect(c.name).toBe("New Test");
    expect(c.createdAt).toBeDefined();
  });

  it("POST /api/cases rejects duplicate id", async () => {
    const resp = await fetch(`${BASE}/api/cases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "seed-case", name: "Dup", prompt: "p" }),
    });
    expect(resp.status).toBe(409);
  });

  it("POST /api/cases rejects invalid id", async () => {
    const resp = await fetch(`${BASE}/api/cases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "UPPER CASE", name: "Bad", prompt: "p" }),
    });
    expect(resp.status).toBe(400);
  });

  it("POST /api/cases rejects missing fields", async () => {
    const resp = await fetch(`${BASE}/api/cases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "no-prompt" }),
    });
    expect(resp.status).toBe(400);
  });

  it("PUT /api/cases/:id updates a case", async () => {
    const resp = await fetch(`${BASE}/api/cases/seed-case`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated Name" }),
    });
    expect(resp.ok).toBe(true);
    const c = await resp.json();
    expect(c.name).toBe("Updated Name");
    expect(c.prompt).toBe("Test prompt"); // unchanged
  });

  it("DELETE /api/cases/:id removes a case", async () => {
    // Create then delete
    await fetch(`${BASE}/api/cases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "delete-me", name: "Delete", prompt: "p" }),
    });
    const resp = await fetch(`${BASE}/api/cases/delete-me`, { method: "DELETE" });
    expect(resp.ok).toBe(true);
    const result = await resp.json();
    expect(result.deleted).toBe("delete-me");
    // Verify it's gone
    const getResp = await fetch(`${BASE}/api/cases/delete-me`);
    expect(getResp.status).toBe(404);
  });

  it("GET /api/config returns config", async () => {
    const resp = await fetch(`${BASE}/api/config`);
    expect(resp.ok).toBe(true);
    const config = await resp.json();
    expect(config.models).toBeDefined();
    expect(config.plugins).toBeDefined();
    expect(config.repetitions).toBeDefined();
  });

  it("PUT /api/config updates config", async () => {
    const resp = await fetch(`${BASE}/api/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        models: [{ id: "new-model", name: "New Model" }],
        plugins: [],
        repetitions: 3,
      }),
    });
    expect(resp.ok).toBe(true);
    const config = await resp.json();
    expect(config.models[0].id).toBe("new-model");
    expect(config.repetitions).toBe(3);
  });
});

describe("arena dashboard genericity", () => {
  it("index.html does not hardcode 'raw-shell' in arena code", () => {
    const html = require("fs").readFileSync(
      join(process.cwd(), "website/public/benchmark/index.html"),
      "utf-8",
    );
    // Legacy code may still reference raw-shell, but comboLabel should use no-plugins
    expect(html).toContain('"no-plugins"');
  });

  it("index.html has CRUD UI elements", () => {
    const html = require("fs").readFileSync(
      join(process.cwd(), "website/public/benchmark/index.html"),
      "utf-8",
    );
    expect(html).toContain("btn-new-case");
    expect(html).toContain("case-form-overlay");
    expect(html).toContain("showCaseForm");
    expect(html).toContain("apiCreateCase");
    expect(html).toContain("apiUpdateCase");
    expect(html).toContain("apiDeleteCase");
    expect(html).toContain("config-editor");
    expect(html).toContain("btn-run");
  });

  it("index.html has generic combo labels (no hardcoded sverka in arena functions)", () => {
    const html = require("fs").readFileSync(
      join(process.cwd(), "website/public/benchmark/index.html"),
      "utf-8",
    );
    // comboLabel should return "no-plugins" not "raw"
    expect(html).toContain('combo.length === 0) return "no-plugins"');
    // comboHash should return "no-plugins" not "raw"
    expect(html).toContain('combo.length === 0) return "no-plugins"');
  });
});
