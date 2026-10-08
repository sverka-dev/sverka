// Hub server — full API against a real instance on an ephemeral port.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startHubServer } from "../server.js";
import { parseTokensFile } from "../auth.js";
import type { HubServer } from "../types.js";

const RW_TOKEN = "svk_writertoken123";
const RO_TOKEN = "svk_readertoken123";
const TOKENS = [
  { name: "writer", token: RW_TOKEN, access: "rw" as const },
  { name: "reader", token: RO_TOKEN, access: "ro" as const },
];

let dir: string;
let hub: HubServer;

async function api(
  path: string,
  init?: RequestInit & { token?: string },
): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (init?.token !== undefined) {
    headers.set("Authorization", `Bearer ${init.token}`);
  }
  return fetch(`${hub.url}${path}`, { ...init, headers });
}

async function jsonBody<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function report(steps: { stepId: string; status: string }[]) {
  return {
    schema: "sverka.run/v1",
    data: { planId: "rp-1", status: "success", steps, findings: 0 },
    durationMs: 100,
  };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "sverka-hub-"));
  hub = await startHubServer({
    dataDir: dir,
    port: 0,
    host: "127.0.0.1",
    tokens: TOKENS,
  });
});

afterEach(async () => {
  await hub.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("auth", () => {
  it("rejects requests without a token", async () => {
    const res = await api("/v1/runs");
    expect(res.status).toBe(401);
  });

  it("rejects a bad token", async () => {
    const res = await api("/v1/runs", { token: "nope" });
    expect(res.status).toBe(401);
  });

  it("read-only token can GET but not POST/PUT", async () => {
    expect((await api("/v1/runs", { token: RO_TOKEN })).status).toBe(200);
    const put = await api("/v1/cache/p/k", {
      method: "PUT",
      token: RO_TOKEN,
      body: "x",
    });
    expect(put.status).toBe(403);
    expect(await jsonBody<{ code: string }>(put)).toEqual({
      code: "READ_ONLY",
      message: expect.any(String),
    });
    const post = await api("/v1/runs", {
      method: "POST",
      token: RO_TOKEN,
      body: "{}",
    });
    expect(post.status).toBe(403);
  });

  it("ping is unauthenticated", async () => {
    const res = await api("/v1/ping");
    expect(res.status).toBe(200);
    expect(await jsonBody<{ status: string }>(res)).toEqual({
      status: "ok",
    });
  });
});

describe("cache blobs", () => {
  it("PUT then GET round-trips a blob", async () => {
    const blob = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 1, 2, 3]);
    const put = await api("/v1/cache/acme%2Fapp/build-linux", {
      method: "PUT",
      token: RW_TOKEN,
      body: blob,
    });
    expect(put.status).toBe(201);
    const get = await api("/v1/cache/acme%2Fapp/build-linux", {
      token: RW_TOKEN,
    });
    expect(get.status).toBe(200);
    expect(get.headers.get("x-sverka-cache-key")).toBe("build-linux");
    expect(Buffer.from(await get.arrayBuffer())).toEqual(blob);
  });

  it("prefix restore returns the newest matching key", async () => {
    for (const key of ["build-linux-aaa", "build-linux-bbb"]) {
      await api(`/v1/cache/p/${key}`, {
        method: "PUT",
        token: RW_TOKEN,
        body: `blob-${key}`,
      });
      await new Promise((r) => setTimeout(r, 5));
    }
    const res = await api("/v1/cache/p/build-linux", { token: RW_TOKEN });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-sverka-cache-key")).toBe("build-linux-bbb");
    expect(await res.text()).toBe("blob-build-linux-bbb");
  });

  it("rejects invalid keys and unknown blobs", async () => {
    const bad = await api("/v1/cache/p/bad_key!", { token: RW_TOKEN });
    expect(bad.status).toBe(400);
    const missing = await api("/v1/cache/p/nope", { token: RW_TOKEN });
    expect(missing.status).toBe(404);
  });
});

describe("snapshots", () => {
  it("PUT/GET/DELETE round-trips a snapshot", async () => {
    const snap = { runId: "r1", planId: "p", status: "suspended" };
    const put = await api("/v1/snapshots/acme%2Fapp/r1", {
      method: "PUT",
      token: RW_TOKEN,
      body: JSON.stringify(snap),
    });
    expect(put.status).toBe(201);
    const get = await api("/v1/snapshots/acme%2Fapp/r1", {
      token: RW_TOKEN,
    });
    expect(await get.json()).toEqual(snap);
    const del = await api("/v1/snapshots/acme%2Fapp/r1", {
      method: "DELETE",
      token: RW_TOKEN,
    });
    expect(del.status).toBe(204);
    expect(
      (await api("/v1/snapshots/acme%2Fapp/r1", { token: RW_TOKEN })).status,
    ).toBe(404);
  });

  it("rejects traversal run ids", async () => {
    const res = await api("/v1/snapshots/p/..%2F..%2Fetc", {
      method: "PUT",
      token: RW_TOKEN,
      body: "{}",
    });
    expect(res.status).toBe(400);
  });
});

describe("runs", () => {
  it("POST then list and detail round-trips", async () => {
    const post = await api("/v1/runs", {
      method: "POST",
      token: RW_TOKEN,
      body: JSON.stringify({
        project: "acme/app",
        entry: "ci/on-push",
        report: report([
          { stepId: "ci/build", status: "succeeded" },
          { stepId: "ci/test", status: "failed" },
        ]),
        findings: [
          { id: "f1", severity: "high" },
          { id: "f2", severity: "high" },
          { id: "f3", severity: "low" },
        ],
      }),
    });
    expect(post.status).toBe(201);
    const { runId, url } = await jsonBody<{ runId: string; url: string }>(post);
    expect(typeof runId).toBe("string");

    const list = await api("/v1/runs?project=acme%2Fapp", {
      token: RW_TOKEN,
    });
    const runs = await jsonBody<
      {
        runId: string;
        findingCounts: { total: number; bySeverity: Record<string, number> };
      }[]
    >(list);
    expect(runs).toHaveLength(1);
    const first = runs[0];
    expect(first?.runId).toBe(runId);
    expect(first?.findingCounts).toEqual({
      total: 3,
      bySeverity: { high: 2, low: 1 },
    });

    const detail = await api(`${url}`, { token: RW_TOKEN });
    const body = await jsonBody<{
      project: string;
      report: { schema: string };
      findings: unknown[];
    }>(detail);
    expect(body.project).toBe("acme/app");
    expect(body.report.schema).toBe("sverka.run/v1");
    expect(body.findings).toHaveLength(3);
  });

  it("rejects malformed bodies", async () => {
    const res = await api("/v1/runs", {
      method: "POST",
      token: RW_TOKEN,
      body: JSON.stringify({ entry: "x" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("flaky aggregation", () => {
  it("computes per-step success rates across runs", async () => {
    const posts = [
      report([
        { stepId: "ci/a", status: "succeeded" },
        { stepId: "ci/b", status: "failed" },
      ]),
      report([
        { stepId: "ci/a", status: "succeeded" },
        { stepId: "ci/b", status: "succeeded" },
      ]),
      report([
        { stepId: "ci/a", status: "failed" },
        { stepId: "ci/b", status: "skipped" }, // excluded
      ]),
    ];
    for (const r of posts) {
      await api("/v1/runs", {
        method: "POST",
        token: RW_TOKEN,
        body: JSON.stringify({ project: "p", entry: "e", report: r }),
      });
    }
    const res = await api("/v1/flaky/p", { token: RW_TOKEN });
    const { rows } = await jsonBody<{
      rows: { stepId: string; successRate: number; runs: number }[];
    }>(res);
    const a = rows.find((r) => r.stepId === "ci/a");
    const b = rows.find((r) => r.stepId === "ci/b");
    expect(a?.successRate).toBeCloseTo(2 / 3);
    expect(a?.runs).toBe(3);
    expect(b?.successRate).toBeCloseTo(1 / 2);
    expect(b?.runs).toBe(2);
  });
});

describe("dashboard", () => {
  it("serves the index, run list, detail, findings and flaky pages", async () => {
    await api("/v1/runs", {
      method: "POST",
      token: RW_TOKEN,
      body: JSON.stringify({
        project: "acme/app",
        entry: "ci/on-push",
        runId: "run-x",
        report: report([{ stepId: "ci/a", status: "succeeded" }]),
        findings: [],
      }),
    });

    for (const path of ["/", "/?project=acme%2Fapp", "/flaky/acme%2Fapp"]) {
      const res = await api(path, { token: RW_TOKEN });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(res.headers.get("content-security-policy")).toContain(
        "default-src",
      );
    }

    const detail = await api("/runs/acme%2Fapp/run-x", {
      token: RW_TOKEN,
    });
    expect(detail.status).toBe(200);
    expect(await detail.text()).toContain("Run run-x");

    const findings = await api("/runs/acme%2Fapp/run-x/findings", {
      token: RW_TOKEN,
    });
    expect(findings.status).toBe(200);
    expect(findings.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  it("sets the cookie when ?token= is used", async () => {
    const res = await api(`/?token=${RW_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("hub_token=");
  });
});

describe("tokens file", () => {
  it("parses name:token:ro|rw lines, skipping comments and junk", () => {
    const parsed = parseTokensFile(
      [
        "# comment",
        "writer:svk_abcdefgh:rw",
        "reader:svk_ijklmnop:ro",
        "bad",
        "short:tiny:rw",
        "noperms:svk_qrstuvwx:xx",
        "",
      ].join("\n"),
    );
    expect(parsed).toEqual([
      { name: "writer", token: "svk_abcdefgh", access: "rw" },
      { name: "reader", token: "svk_ijklmnop", access: "ro" },
    ]);
  });
});
