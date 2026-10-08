// Remote hub client — CacheStore/SnapshotStore/upload against a fixture
// hub server (in-process node:http implementing the /v1/ surface).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { zstdCompressSync } from "node:zlib";
import { packTar } from "../internal/tar.js";
import {
  createRemoteCacheStore,
  createRemoteSnapshotStore,
  uploadRunReport,
  listRuns,
  getRun,
} from "../remote.js";
import { HubError } from "../errors.js";
import { makeSnapshot } from "./helpers/fixtures.js";

interface FixtureHub {
  readonly url: string;
  readonly cache: Map<string, { key: string; blob: Buffer }>;
  readonly snapshots: Map<string, string>;
  readonly runs: {
    project: string;
    entry: string;
    runId: string;
    report: unknown;
    findings: unknown[];
    uploadedAt: number;
  }[];
  readonly tokens: Map<string, "ro" | "rw">;
  close(): Promise<void>;
}

/** Minimal /v1/ hub — in-memory, exact+prefix cache match, token auth. */
async function startFixtureHub(opts?: { token?: string }): Promise<FixtureHub> {
  const cache = new Map<string, { key: string; blob: Buffer }>();
  const snapshots = new Map<string, string>();
  const runs: FixtureHub["runs"] = [];
  const tokens = new Map<string, "ro" | "rw">();
  if (opts?.token !== undefined) tokens.set(opts.token, "rw");
  tokens.set("readonly", "ro");

  const readBody = (req: IncomingMessage): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://x");
      const path = url.pathname;
      const auth = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      const access = tokens.get(auth);
      if (access === undefined) {
        res.writeHead(401).end("unauthorized");
        return;
      }
      if (access === "ro" && req.method !== "GET") {
        res.writeHead(403).end("read-only");
        return;
      }

      const cacheMatch = /^\/v1\/cache\/(.+)\/([^/]+)$/.exec(path);
      if (cacheMatch) {
        const project = decodeURIComponent(cacheMatch[1]!);
        const key = decodeURIComponent(cacheMatch[2]!);
        if (!/^[a-z0-9-]{1,128}$/.test(key)) {
          res.writeHead(400).end("bad key");
          return;
        }
        if (req.method === "PUT") {
          const blob = await readBody(req);
          const slot = `${project}:${createHash("sha256").update(key).digest("hex")}`;
          cache.set(slot, { key, blob });
          res.writeHead(201).end();
          return;
        }
        if (req.method === "GET") {
          const want = `${project}:${createHash("sha256").update(key).digest("hex")}`;
          const exact = cache.get(want);
          if (exact !== undefined) {
            res.writeHead(200, { "x-sverka-cache-key": exact.key });
            res.end(exact.blob);
            return;
          }
          // Prefix fallback — opt-in via ?prefix=1 (restoreKeys), newest
          // write whose raw key starts with `key`. Matches the real hub.
          if (url.searchParams.get("prefix") === "1") {
            let best: { key: string; blob: Buffer } | undefined;
            for (const entry of cache.values()) {
              if (entry.key.startsWith(key)) best = entry;
            }
            if (best !== undefined) {
              res.writeHead(200, { "x-sverka-cache-key": best.key });
              res.end(best.blob);
              return;
            }
          }
          res.writeHead(404).end();
          return;
        }
      }

      const snapMatch = /^\/v1\/snapshots\/(.+)\/([^/]+)$/.exec(path);
      if (snapMatch) {
        const id = decodeURIComponent(snapMatch[2]!);
        if (req.method === "PUT") {
          snapshots.set(id, (await readBody(req)).toString("utf8"));
          res.writeHead(201).end();
          return;
        }
        if (req.method === "GET") {
          const text = snapshots.get(id);
          if (text === undefined) {
            res.writeHead(404).end();
          } else {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(text);
          }
          return;
        }
        if (req.method === "DELETE") {
          res.writeHead(snapshots.delete(id) ? 204 : 404).end();
          return;
        }
      }

      if (path === "/v1/runs" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)).toString("utf8")) as {
          project: string;
          entry: string;
          runId?: string;
          report: unknown;
          findings: unknown[];
        };
        const runId = body.runId ?? `run-${runs.length + 1}`;
        runs.push({
          project: body.project,
          entry: body.entry,
          runId,
          report: body.report,
          findings: body.findings,
          uploadedAt: Date.now(),
        });
        res.writeHead(201, { "content-type": "application/json" });
        res.end(
          JSON.stringify({ runId, url: `/runs/${body.project}/${runId}` }),
        );
        return;
      }
      if (path === "/v1/runs" && req.method === "GET") {
        const project = url.searchParams.get("project") ?? "";
        const limit = Number(url.searchParams.get("limit") ?? 50);
        const rows = runs
          .filter((r) => r.project === project)
          .slice(0, limit)
          .map((r) => ({
            runId: r.runId,
            project: r.project,
            entry: r.entry,
            status: "success",
            startedAt: null,
            durationMs: 42,
            findingCounts: { total: r.findings.length, bySeverity: {} },
          }));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(rows));
        return;
      }
      const runMatch = /^\/v1\/runs\/([^/]+)$/.exec(path);
      if (runMatch && req.method === "GET") {
        const run = runs.find((r) => r.runId === runMatch[1]);
        if (run === undefined) {
          res.writeHead(404).end();
        } else {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ...run, report: run.report }));
        }
        return;
      }
      res.writeHead(404).end("not found");
    })().catch((e) => {
      res.writeHead(500).end(String(e));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    cache,
    snapshots,
    runs,
    tokens,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

const CONFIG = (url: string) => ({
  url,
  token: "test-token",
  project: "acme/app",
});

describe("createRemoteCacheStore", () => {
  let hub: FixtureHub | undefined;
  let dir: string;

  beforeEach(async () => {
    hub = await startFixtureHub({ token: "test-token" });
    dir = await mkdtemp(join(tmpdir(), "sverka-remote-"));
  });
  afterEach(async () => {
    await hub?.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("store → restore round-trip yields identical files", async () => {
    const src = join(dir, "src");
    const dst = join(dir, "dst");
    await mkdir(join(src, "sub"), { recursive: true });
    await writeFile(join(src, "a.txt"), "alpha");
    await writeFile(join(src, "sub", "b.txt"), "beta");
    const store = createRemoteCacheStore(CONFIG(hub!.url));

    await store.store({
      key: "build-linux-abc",
      paths: ["sub", "a.txt"],
      sourceDir: src,
    });
    const hit = await store.restore({
      key: "build-linux-abc",
      restoreKeys: [],
      paths: ["sub", "a.txt"],
      targetDir: dst,
    });
    expect(hit).toEqual({ key: "build-linux-abc" });
    expect(await readFile(join(dst, "a.txt"), "utf8")).toBe("alpha");
    expect(await readFile(join(dst, "sub", "b.txt"), "utf8")).toBe("beta");
  });

  it("restore miss on hub 404 → undefined, no throw", async () => {
    const store = createRemoteCacheStore(CONFIG(hub!.url));
    const hit = await store.restore({
      key: "nope-nothing",
      restoreKeys: [],
      paths: ["x"],
      targetDir: join(dir, "dst"),
    });
    expect(hit).toBeUndefined();
  });

  it("restore falls back to restoreKeys via hub prefix match", async () => {
    const src = join(dir, "src");
    const dst = join(dir, "dst");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "a.txt"), "alpha");
    const store = createRemoteCacheStore(CONFIG(hub!.url));
    await store.store({
      key: "build-linux-deadbeef",
      paths: ["a.txt"],
      sourceDir: src,
    });

    const hit = await store.restore({
      key: "build-linux-other",
      restoreKeys: ["build-linux-"],
      paths: ["a.txt"],
      targetDir: dst,
    });
    expect(hit).toEqual({ key: "build-linux-deadbeef" });
    expect(await readFile(join(dst, "a.txt"), "utf8")).toBe("alpha");
  });

  it("primary key does not prefix-match (restoreKeys only)", async () => {
    const src = join(dir, "src");
    const dst = join(dir, "dst");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "a.txt"), "alpha");
    const store = createRemoteCacheStore(CONFIG(hub!.url));
    await store.store({
      key: "build-linux-deadbeef",
      paths: ["a.txt"],
      sourceDir: src,
    });

    // "build" is a pure prefix of the stored key — an exact-key GET must
    // not return a different key's blob.
    const hit = await store.restore({
      key: "build",
      restoreKeys: [],
      paths: ["a.txt"],
      targetDir: dst,
    });
    expect(hit).toBeUndefined();
  });

  it("blob missing a declared path counts as a miss, not a hit", async () => {
    const src = join(dir, "src");
    const dst = join(dir, "dst");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "a.txt"), "alpha");
    const store = createRemoteCacheStore(CONFIG(hub!.url));
    await store.store({
      key: "partial-entry",
      paths: ["a.txt"],
      sourceDir: src,
    });

    const hit = await store.restore({
      key: "partial-entry",
      restoreKeys: [],
      paths: ["a.txt", "b.txt"],
      targetDir: dst,
    });
    expect(hit).toBeUndefined();
    // A miss must not leave a half-restored tree behind.
    await expect(readFile(join(dst, "a.txt"), "utf8")).rejects.toThrow();
  });

  it("restored files keep their executable mode", async () => {
    const src = join(dir, "src");
    const dst = join(dir, "dst");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "run.sh"), "#!/bin/sh\ntrue\n", {
      mode: 0o755,
    });
    const store = createRemoteCacheStore(CONFIG(hub!.url));
    await store.store({ key: "exec-key", paths: ["run.sh"], sourceDir: src });
    const hit = await store.restore({
      key: "exec-key",
      restoreKeys: [],
      paths: ["run.sh"],
      targetDir: dst,
    });
    expect(hit).toEqual({ key: "exec-key" });
    const { stat } = await import("node:fs/promises");
    expect((await stat(join(dst, "run.sh"))).mode & 0o111).not.toBe(0);
  });

  it("refuses a blob that writes through a planted symlink", async () => {
    // A hostile blob can declare a contained symlink, then a file entry
    // beneath it — the file write must not follow the link.
    const tar = packTar([
      { name: "sub", type: "symlink", linkname: "real" },
      {
        name: "sub/evil.txt",
        type: "file",
        data: new TextEncoder().encode("x"),
      },
    ]);
    const put = await fetch(`${hub!.url}/v1/cache/acme%2Fapp/evil-key`, {
      method: "PUT",
      headers: { Authorization: "Bearer test-token" },
      body: zstdCompressSync(Buffer.from(tar)),
    });
    expect(put.status).toBe(201);

    const store = createRemoteCacheStore(CONFIG(hub!.url));
    await expect(
      store.restore({
        key: "evil-key",
        restoreKeys: [],
        paths: ["sub"],
        targetDir: join(dir, "dst"),
      }),
    ).rejects.toThrow(HubError);
  });

  it("a blob whose only coverage is an escaping symlink counts as a miss", async () => {
    // "link" is present in the tar but its target escapes the target dir —
    // it will not be written, so it must not count as coverage.
    const tar = packTar([
      { name: "link", type: "symlink", linkname: "/etc/passwd" },
    ]);
    await fetch(`${hub!.url}/v1/cache/acme%2Fapp/link-key`, {
      method: "PUT",
      headers: { Authorization: "Bearer test-token" },
      body: zstdCompressSync(Buffer.from(tar)),
    });
    const store = createRemoteCacheStore(CONFIG(hub!.url));
    const hit = await store.restore({
      key: "link-key",
      restoreKeys: [],
      paths: ["link"],
      targetDir: join(dir, "dst"),
    });
    expect(hit).toBeUndefined();
  });

  it("malformed keys surface as HubError (hub 400)", async () => {
    const store = createRemoteCacheStore(CONFIG(hub!.url));
    await expect(
      store.store({ key: "BAD_KEY!", paths: [], sourceDir: dir }),
    ).rejects.toBeInstanceOf(HubError);
  });

  it("network failure → HubError REMOTE_UNAVAILABLE", async () => {
    await hub!.close();
    const store = createRemoteCacheStore({
      ...CONFIG(hub!.url),
      timeoutMs: 500,
    });
    await expect(
      store.restore({ key: "k", restoreKeys: [], paths: [], targetDir: dir }),
    ).rejects.toMatchObject({ code: "REMOTE_UNAVAILABLE" });
  });
});

describe("createRemoteSnapshotStore", () => {
  let hub: FixtureHub | undefined;
  beforeEach(async () => {
    hub = await startFixtureHub({ token: "test-token" });
  });
  afterEach(async () => {
    await hub?.close();
  });

  it("save → load → delete round-trip", async () => {
    const store = createRemoteSnapshotStore(CONFIG(hub!.url));
    const snapshot = makeSnapshot("run-42");
    await store.save(snapshot);
    const loaded = await store.load("run-42");
    expect(loaded).toEqual(snapshot);
    await store.delete("run-42");
    expect(await store.load("run-42")).toBeUndefined();
  });

  it("load miss → undefined; delete is idempotent", async () => {
    const store = createRemoteSnapshotStore(CONFIG(hub!.url));
    expect(await store.load("nope")).toBeUndefined();
    await store.delete("nope"); // no throw
  });
});

describe("uploadRunReport / listRuns / getRun", () => {
  let hub: FixtureHub | undefined;
  beforeEach(async () => {
    hub = await startFixtureHub({ token: "test-token" });
  });
  afterEach(async () => {
    await hub?.close();
  });

  const REPORT = {
    schema: "sverka.run/v1",
    data: { planId: "rp-1", status: "success", steps: [], findings: 0 },
    durationMs: 42,
  };

  it("uploads report + findings, returns runId and url", async () => {
    const cfg = CONFIG(hub!.url);
    const result = await uploadRunReport(cfg, REPORT, [], {
      entry: "ci/on-push",
      runId: "run-local-1",
    });
    expect(result.runId).toBe("run-local-1");
    expect(hub!.runs).toHaveLength(1);
    expect(hub!.runs[0]).toMatchObject({
      project: "acme/app",
      entry: "ci/on-push",
      report: REPORT,
    });
  });

  it("lists runs for the configured project", async () => {
    const cfg = CONFIG(hub!.url);
    await uploadRunReport(cfg, REPORT, [], { entry: "e1" });
    await uploadRunReport(cfg, REPORT, [], { entry: "e2" });
    const rows = await listRuns(cfg);
    expect(rows.map((r) => r.entry)).toEqual(["e1", "e2"]);
  });

  it("getRun returns report + findings; 404 → undefined", async () => {
    const cfg = CONFIG(hub!.url);
    const uploaded = await uploadRunReport(
      cfg,
      REPORT,
      [{ id: "f1" } as never],
      { entry: "e" },
    );
    const detail = await getRun(cfg, uploaded.runId);
    expect(detail?.findings).toEqual([{ id: "f1" }]);
    expect(await getRun(cfg, "nope")).toBeUndefined();
  });

  it("401/403 → HubError REMOTE_REJECTED naming sverka login", async () => {
    const cfg = { ...CONFIG(hub!.url), token: "wrong" };
    await expect(
      uploadRunReport(cfg, REPORT, [], { entry: "e" }),
    ).rejects.toMatchObject({
      code: "REMOTE_REJECTED",
      message: expect.stringContaining("sverka login"),
    });
  });
});
