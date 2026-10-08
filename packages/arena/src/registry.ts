/**
 * Arena results registry — `arena.result/v1` documents committed to an
 * append-only store, plus the `ArenaRegistry` read/write contract.
 * Spec: specs/56-arena-eval-service.
 *
 * Registry tree layout:
 *
 *   results/<pack>/<agent>/<YYYY-MM-DD>/<runId>.json
 *   traces/<runId>/<task>.trace.jsonl
 *   packs/<name>/pack.json + tasks/*.json
 *   index.json                    — denormalized pack → runs; readers
 *                                   never scan the results/ tree
 *
 * Backends: file (local dir — a git checkout or plain tree), git
 * (clone → write → commit → push), s3 (put-object via an injectable
 * client — no AWS SDK dependency in tests).
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { z } from "zod";

import { ArenaError } from "./config.js";
import { git, gitOrThrow } from "./internal/git.js";

// ─── arena.result/v1 ─────────────────────────────────────────────────

export interface TaskResult {
  readonly task: string;
  /** sha256 of the task prompt — a prompt edit breaks comparability. */
  readonly promptHash: string;
  readonly score: { readonly passed: boolean; readonly findings: number };
  readonly metrics: {
    readonly tokens?: number;
    readonly toolCalls?: number;
    readonly durationMs: number;
    readonly stopReason?: string;
  };
  readonly traceRef?: string;
}

export interface ArenaResultV1 {
  readonly schema: "arena.result/v1";
  readonly runId: string;
  readonly pack: string;
  readonly agent: string;
  readonly model: string;
  readonly plugins: readonly string[];
  readonly sverkaVersion: string;
  readonly startedAt: string;
  readonly tasks: readonly TaskResult[];
}

const taskResultSchema = z.object({
  task: z.string().min(1),
  promptHash: z.string().regex(/^[0-9a-f]{64}$/),
  score: z.object({
    passed: z.boolean(),
    findings: z.number().int().nonnegative(),
  }),
  metrics: z.object({
    tokens: z.number().optional(),
    toolCalls: z.number().optional(),
    durationMs: z.number(),
    stopReason: z.string().optional(),
  }),
  traceRef: z.string().optional(),
});

export const arenaResultV1Schema = z.object({
  schema: z.literal("arena.result/v1"),
  runId: z.string().min(1),
  pack: z.string().min(1),
  agent: z.string().min(1),
  model: z.string().min(1),
  plugins: z.array(z.string()),
  sverkaVersion: z.string().min(1),
  startedAt: z.iso.datetime(),
  tasks: z.array(taskResultSchema),
});

/** Validate a parsed value as arena.result/v1 — names failing fields. */
export function parseArenaResultV1(doc: unknown): ArenaResultV1 {
  const parsed = arenaResultV1Schema.safeParse(doc);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new ArenaError(
      `invalid arena.result/v1 document:\n${issues}`,
      "SCHEMA_INVALID",
    );
  }
  return parsed.data as ArenaResultV1;
}

/** Registry path segments must not escape or nest the layout. */
function checkSegment(value: string, field: string): void {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value) ||
    value === "." ||
    value === ".."
  ) {
    throw new ArenaError(
      `invalid ${field} '${value}' — registry path segments must match [a-zA-Z0-9._-]+ and not start with a dot`,
      "SCHEMA_INVALID",
    );
  }
}

/** Canonical result path: results/<pack>/<agent>/<YYYY-MM-DD>/<runId>.json */
export function resultPath(doc: ArenaResultV1, date?: string): string {
  checkSegment(doc.pack, "pack");
  checkSegment(doc.agent, "agent");
  checkSegment(doc.runId, "runId");
  const day = date ?? doc.startedAt.slice(0, 10);
  // The partition lands inside a filesystem path — a date override must
  // be a strict YYYY-MM-DD, never a traversal like "../../tmp/out".
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new ArenaError(
      `invalid date partition '${day}' — expected YYYY-MM-DD`,
      "SCHEMA_INVALID",
    );
  }
  return `results/${doc.pack}/${doc.agent}/${day}/${doc.runId}.json`;
}

/** sha256 of a task prompt — the comparability cohort key. */
export function promptHash(prompt: string): string {
  return createHash("sha256").update(prompt, "utf8").digest("hex");
}

// ─── ArenaRegistry ───────────────────────────────────────────────────

/** A trace payload: a filesystem path to copy, or inline data. */
export type TraceInput = string | { name: string; data: unknown };

export interface PublishOptions {
  /** Trace files/payloads — written under traces/<runId>/<name>. */
  traces?: readonly TraceInput[];
  /** Override the YYYY-MM-DD partition (default: startedAt day). */
  date?: string;
}

export interface ListQuery {
  pack?: string;
  agent?: string;
  /** ISO date/datetime lower bound on startedAt (inclusive). */
  since?: string;
}

export interface ArenaRegistry {
  publish(result: ArenaResultV1, opts?: PublishOptions): Promise<string>;
  list(query?: ListQuery): Promise<ArenaResultV1[]>;
}

// ─── Tree backends (internal) ────────────────────────────────────────

/** Uniform read/write view over the registry tree per backend. */
interface TreeStore {
  readFile(rel: string): Promise<string | null>;
  writeFile(rel: string, data: string): Promise<void>;
  /** Relative posix paths under relPrefix, recursive. */
  listFiles(relPrefix: string): Promise<string[]>;
  /** Commit/publish pending writes — git commits + pushes; others no-op. */
  finalize(message: string): Promise<void>;
}

const registries = new WeakMap<ArenaRegistry, TreeStore>();

function createFileTree(dir: string): TreeStore {
  const unavailable = (what: string, cause: unknown): ArenaError =>
    new ArenaError(
      `registry unavailable — ${what} under ${dir}`,
      "REGISTRY_UNAVAILABLE",
      cause,
    );
  return {
    async readFile(rel) {
      try {
        return await readFile(join(dir, rel), "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw unavailable(`cannot read ${rel}`, err);
      }
    },
    async writeFile(rel, data) {
      const target = join(dir, rel);
      try {
        await mkdir(join(target, ".."), { recursive: true });
        // 0o600 — registry roots may live under tmpdir(); keep the
        // created file owner-only (CodeQL js/insecure-temporary-file).
        await writeFile(target, data, { encoding: "utf8", mode: 0o600 });
      } catch (err) {
        throw unavailable(`cannot write ${rel}`, err);
      }
    },
    async listFiles(relPrefix) {
      const out: string[] = [];
      const walk = async (rel: string): Promise<void> => {
        let entries;
        try {
          entries = await readdir(join(dir, rel), { withFileTypes: true });
        } catch (err) {
          // Only ENOENT means "empty subtree" — permission or I/O
          // failures must surface (a silent empty list would let
          // `reindex` overwrite index.json with nothing).
          if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
          throw unavailable(`cannot list ${rel}`, err);
        }
        for (const e of entries) {
          const child = rel === "" ? e.name : `${rel}/${e.name}`;
          if (e.isDirectory()) await walk(child);
          else if (e.isFile()) out.push(child);
        }
      };
      await walk(relPrefix);
      return out;
    },
    async finalize() {},
  };
}

// ─── Git backend ─────────────────────────────────────────────────────

export interface GitRegistryConfig {
  /** Clone URL — https or git@. */
  url: string;
  /** Branch to publish on (default: "main"). */
  branch?: string;
  /** Local checkout dir (default: a tmp cache keyed by URL). */
  dir?: string;
  /** Bearer token for https remotes (header-scoped, never persisted). */
  token?: string;
}

function gitRegistryDir(cfg: GitRegistryConfig): string {
  return (
    cfg.dir ??
    join(
      tmpdir(),
      `arena-registry-${createHash("sha256").update(cfg.url).digest("hex").slice(0, 12)}`,
    )
  );
}

/**
 * Auth is injected through GIT_CONFIG_* env vars, never argv — a
 * `-c http.extraHeader=...` argument would expose the bearer token to
 * other users on the host via the process list (CWE-214).
 */
function gitAuthEnv(cfg: GitRegistryConfig): Record<string, string> {
  return cfg.token !== undefined && /^https?:\/\//.test(cfg.url)
    ? {
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "http.extraHeader",
        GIT_CONFIG_VALUE_0: `AUTHORIZATION: bearer ${cfg.token}`,
      }
    : {};
}

const gitUnavailable =
  (cfg: GitRegistryConfig, dir: string) =>
  (what: string, cause: unknown): ArenaError =>
    new ArenaError(
      `registry unavailable — ${what} (${cfg.url} → ${dir})`,
      "REGISTRY_UNAVAILABLE",
      cause,
    );

const checkouts = new Map<string, Promise<void>>();

/**
 * Clone-or-refresh a git registry checkout (memoized per dir). Soft on
 * refresh when a checkout exists — a stale local view stays readable;
 * publish does its own pull --rebase anyway.
 */
function ensureGitCheckout(cfg: GitRegistryConfig): Promise<void> {
  const dir = gitRegistryDir(cfg);
  const branch = cfg.branch ?? "main";
  const auth = gitAuthEnv(cfg);
  const unavailable = gitUnavailable(cfg, dir);
  let p = checkouts.get(dir);
  if (p === undefined) {
    p = (async () => {
      if (cfg.dir === undefined) {
        // The auto-derived tmpdir path is predictable — keep it
        // owner-only so results/credentials stay private (CWE-377).
        await mkdir(dir, { recursive: true, mode: 0o700 });
        await chmod(dir, 0o700);
      }
      if (existsSync(join(dir, ".git"))) {
        await git(["-C", dir, "fetch", "origin", branch], { env: auth });
        return;
      }
      try {
        await gitOrThrow(
          [
            "clone",
            ...(cfg.branch !== undefined ? ["--branch", cfg.branch] : []),
            cfg.url,
            dir,
          ],
          { env: auth },
        );
      } catch (err) {
        throw unavailable(`git clone failed`, err);
      }
    })();
    checkouts.set(dir, p);
    // A failed clone must not poison the memo — retry next call. The
    // identity check keeps a concurrent fresh entry from being removed.
    p.catch(() => {
      if (checkouts.get(dir) === p) checkouts.delete(dir);
    });
  }
  return p;
}

const GIT_IDENTITY = [
  "-c",
  "user.name=sverka-arena",
  "-c",
  "user.email=arena@sverka.dev",
];

function createGitTree(cfg: GitRegistryConfig): TreeStore & { dir: string } {
  const dir = gitRegistryDir(cfg);
  const branch = cfg.branch ?? "main";
  const auth = gitAuthEnv(cfg);
  const inner = createFileTree(dir);
  const unavailable = gitUnavailable(cfg, dir);
  const ensure = (): Promise<void> => ensureGitCheckout(cfg);

  async function pullRebase(): Promise<void> {
    // Rebase replays our commit — it needs a committer identity too, and
    // hosts without a global gitconfig (CI) have none.
    const res = await git(
      ["-C", dir, ...GIT_IDENTITY, "pull", "--rebase", "origin", branch],
      { env: auth },
    );
    if (res.code !== 0) {
      throw unavailable(`git pull --rebase failed`, res.stderr.trim());
    }
  }

  async function push(): Promise<ReturnType<typeof git>> {
    return git(["-C", dir, "push", "origin", `HEAD:${branch}`], {
      env: auth,
    });
  }

  return {
    dir,
    async readFile(rel) {
      await ensure();
      return inner.readFile(rel);
    },
    async writeFile(rel, data) {
      await ensure();
      return inner.writeFile(rel, data);
    },
    async listFiles(relPrefix) {
      await ensure();
      return inner.listFiles(relPrefix);
    },
    async finalize(message) {
      await ensure();
      try {
        await gitOrThrow(["-C", dir, "add", "-A"]);
      } catch (err) {
        throw unavailable(`git add failed`, err);
      }
      const staged = await git(["-C", dir, "diff", "--cached", "--quiet"]);
      if (staged.code === 0) return; // nothing to commit
      try {
        await gitOrThrow(["-C", dir, ...GIT_IDENTITY, "commit", "-m", message]);
      } catch (err) {
        throw unavailable(`git commit failed`, err);
      }
      let res = await push();
      if (res.code !== 0) {
        // Non-fast-forward (or auth failure indistinguishable from it):
        // one rebase retry — results are append-only, never force-pushed.
        await pullRebase();
        res = await push();
        if (res.code !== 0) {
          throw new ArenaError(
            `publish rejected — git push to '${cfg.url}' failed after rebase retry; ` +
              `results are preserved in the local checkout at ${dir}`,
            "PUBLISH_CONFLICT",
            res.stderr.trim(),
          );
        }
      }
    },
  };
}

export function createGitRegistry(cfg: GitRegistryConfig): ArenaRegistry {
  const tree = createGitTree(cfg);
  const registry = createRegistry(tree);
  registries.set(registry, tree);
  return registry;
}

// ─── S3 backend ──────────────────────────────────────────────────────

/** Minimal structural subset of the AWS SDK S3 client we depend on. */
export interface S3ClientLike {
  putObject(input: {
    Bucket: string;
    Key: string;
    Body: string | Uint8Array;
  }): Promise<unknown>;
  getObject?(input: { Bucket: string; Key: string }): Promise<{
    Body?: unknown;
  }>;
  listObjectsV2?(input: {
    Bucket: string;
    Prefix?: string;
    ContinuationToken?: string;
  }): Promise<{
    Contents?: { Key?: string }[];
    IsTruncated?: boolean;
    NextContinuationToken?: string;
  }>;
}

export interface S3RegistryConfig {
  bucket: string;
  /** Key prefix for the whole registry tree (default: ""). */
  prefix?: string;
  /** Client — injectable so tests need no AWS SDK. When omitted, the
   * optional `@aws-sdk/client-s3` peer is imported lazily. */
  client?: S3ClientLike;
}

type AwsS3Ctor = new (cfg: Record<string, never>) => S3ClientLike;

/** Computed specifier — keeps the optional AWS peer out of the dep graph. */
const S3_SDK_MODULE = "@aws-sdk/client-s3";

async function defaultS3Client(): Promise<S3ClientLike> {
  try {
    const mod = (await import(S3_SDK_MODULE)) as {
      S3Client: AwsS3Ctor;
    };
    return new mod.S3Client({});
  } catch (err) {
    throw new ArenaError(
      `s3 registry requires a client — install @aws-sdk/client-s3 or pass { client }`,
      "REGISTRY_UNAVAILABLE",
      err,
    );
  }
}

async function s3BodyToString(body: unknown): Promise<string> {
  if (body === undefined || body === null) return "";
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  if (
    typeof (body as { transformToString?: unknown }).transformToString ===
    "function"
  ) {
    return (
      body as { transformToString(): Promise<string> }
    ).transformToString();
  }
  if (
    typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] ===
    "function"
  ) {
    const chunks: Uint8Array[] = [];
    for await (const c of body as AsyncIterable<Uint8Array>) chunks.push(c);
    return new TextDecoder().decode(
      chunks.reduce((a, c) => {
        const n = new Uint8Array(a.length + c.length);
        n.set(a);
        n.set(c, a.length);
        return n;
      }, new Uint8Array(0)),
    );
  }
  throw new ArenaError(
    "s3 registry: unsupported getObject Body type",
    "REGISTRY_UNAVAILABLE",
  );
}

/** Strip trailing '/' without a regex — a `\/+$` match on a hostile
 * prefix (many trailing slashes + a non-slash tail) backtracks
 * quadratically (CodeQL js/polynomial-redos). */
function stripTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47) end--;
  return s.slice(0, end);
}

function createS3Tree(cfg: S3RegistryConfig): TreeStore {
  const stripped =
    cfg.prefix === undefined ? "" : stripTrailingSlashes(cfg.prefix);
  const prefix = stripped === "" ? "" : `${stripped}/`;
  let clientP: Promise<S3ClientLike> | undefined;
  const client = (): Promise<S3ClientLike> => {
    clientP ??=
      cfg.client !== undefined
        ? Promise.resolve(cfg.client)
        : defaultS3Client();
    return clientP;
  };
  const unavailable = (what: string, cause: unknown): ArenaError =>
    new ArenaError(
      `s3 registry unavailable — ${what}`,
      "REGISTRY_UNAVAILABLE",
      cause,
    );

  return {
    async readFile(rel) {
      const c = await client();
      if (c.getObject === undefined) {
        throw unavailable(`client has no getObject`, undefined);
      }
      try {
        const res = await c.getObject({
          Bucket: cfg.bucket,
          Key: prefix + rel,
        });
        return await s3BodyToString(res?.Body);
      } catch (err) {
        const name = (err as { name?: string }).name ?? "";
        if (name === "NoSuchKey" || name === "NotFound") return null;
        if (err instanceof ArenaError) throw err;
        throw unavailable(`getObject ${rel} failed`, err);
      }
    },
    async writeFile(rel, data) {
      const c = await client();
      try {
        await c.putObject({
          Bucket: cfg.bucket,
          Key: prefix + rel,
          Body: data,
        });
      } catch (err) {
        throw unavailable(`putObject ${rel} failed`, err);
      }
    },
    async listFiles(relPrefix) {
      const c = await client();
      if (c.listObjectsV2 === undefined) {
        throw unavailable(`client has no listObjectsV2`, undefined);
      }
      const out: string[] = [];
      let token: string | undefined;
      try {
        do {
          const page = await c.listObjectsV2({
            Bucket: cfg.bucket,
            Prefix: prefix + relPrefix,
            ...(token !== undefined ? { ContinuationToken: token } : {}),
          });
          for (const obj of page.Contents ?? []) {
            if (obj.Key !== undefined) out.push(obj.Key.slice(prefix.length));
          }
          token =
            page.IsTruncated === true ? page.NextContinuationToken : undefined;
        } while (token !== undefined);
      } catch (err) {
        throw unavailable(`listObjectsV2 failed`, err);
      }
      return out;
    },
    async finalize() {},
  };
}

export function createS3Registry(cfg: S3RegistryConfig): ArenaRegistry {
  const tree = createS3Tree(cfg);
  const registry = createRegistry(tree);
  registries.set(registry, tree);
  return registry;
}

// ─── File backend ────────────────────────────────────────────────────

/** Registry over a local directory — a git checkout or a plain tree. */
export function createFileRegistry(dir: string): ArenaRegistry {
  const tree = createFileTree(resolve(dir));
  const registry = createRegistry(tree);
  registries.set(registry, tree);
  return registry;
}

// ─── Generic registry over a tree ────────────────────────────────────

interface IndexRun {
  runId: string;
  agent: string;
  date: string;
  path: string;
}

interface RegistryIndex {
  schema: "arena.index/v1";
  updatedAt: string;
  packs: Record<string, { runs: IndexRun[] }>;
}

const INDEX_PATH = "index.json";

async function readIndex(tree: TreeStore): Promise<RegistryIndex> {
  const raw = await tree.readFile(INDEX_PATH);
  if (raw === null) {
    return { schema: "arena.index/v1", updatedAt: "", packs: {} };
  }
  try {
    const parsed = JSON.parse(raw) as RegistryIndex;
    if (
      parsed.schema !== "arena.index/v1" ||
      typeof parsed.packs !== "object" ||
      parsed.packs === null
    ) {
      return { schema: "arena.index/v1", updatedAt: "", packs: {} };
    }
    return parsed;
  } catch {
    return { schema: "arena.index/v1", updatedAt: "", packs: {} };
  }
}

async function writeIndex(
  tree: TreeStore,
  index: RegistryIndex,
): Promise<void> {
  index.updatedAt = new Date().toISOString();
  await tree.writeFile(INDEX_PATH, JSON.stringify(index, null, 2) + "\n");
}

/** Own-property lookup — "constructor" is a valid pack name. */
function indexPack(
  index: RegistryIndex,
  name: string,
): { runs: IndexRun[] } | undefined {
  return Object.hasOwn(index.packs, name) ? index.packs[name] : undefined;
}

async function updateIndex(
  tree: TreeStore,
  doc: ArenaResultV1,
  relPath: string,
): Promise<void> {
  const index = await readIndex(tree);
  const date = relPath.split("/")[3] ?? doc.startedAt.slice(0, 10);
  const pack = indexPack(index, doc.pack) ?? { runs: [] };
  pack.runs = [
    ...pack.runs.filter((r) => r.runId !== doc.runId),
    { runId: doc.runId, agent: doc.agent, date, path: relPath },
  ];
  pack.runs.sort((a, b) =>
    a.date === b.date ? (a.runId < b.runId ? -1 : 1) : a.date < b.date ? -1 : 1,
  );
  index.packs[doc.pack] = pack;
  await writeIndex(tree, index);
}

function matchesQuery(doc: ArenaResultV1, query: ListQuery): boolean {
  if (query.pack !== undefined && doc.pack !== query.pack) return false;
  if (query.agent !== undefined && doc.agent !== query.agent) return false;
  // Compare instants, not strings — "01:00+02:00" sorts after "00:00Z"
  // lexically but is the earlier instant. Unparsable input falls back
  // to including the row (NaN comparisons are false).
  if (
    query.since !== undefined &&
    Date.parse(doc.startedAt) < Date.parse(query.since)
  ) {
    return false;
  }
  return true;
}

function tryParseResult(raw: string | null): ArenaResultV1 | null {
  if (raw === null) return null;
  try {
    const doc = JSON.parse(raw) as { schema?: string };
    if (doc?.schema !== "arena.result/v1") return null;
    return parseArenaResultV1(doc);
  } catch {
    return null; // a stray bad file must not break readers
  }
}

async function writeResult(
  tree: TreeStore,
  doc: ArenaResultV1,
  opts: PublishOptions,
): Promise<string> {
  const valid = parseArenaResultV1(doc);
  const rel = resultPath(valid, opts.date);
  await tree.writeFile(rel, JSON.stringify(valid, null, 2) + "\n");
  for (const trace of opts.traces ?? []) {
    const name =
      typeof trace === "string" ? basename(trace) : basename(trace.name);
    checkSegment(name.replace(/\.[^.]+$/, ""), "trace name");
    const data =
      typeof trace === "string"
        ? await readFile(trace, "utf8")
        : JSON.stringify(trace.data) + "\n"; // single-line — .trace.jsonl stays valid JSONL
    await tree.writeFile(`traces/${valid.runId}/${name}`, data);
  }
  await updateIndex(tree, valid, rel);
  return rel;
}

/**
 * Publish several documents under ONE finalize — a matrix explosion
 * produces one commit+push, not N. Internal: package code only.
 */
export async function publishBatch(
  registry: ArenaRegistry,
  docs: readonly { doc: ArenaResultV1; opts?: PublishOptions }[],
  message: string,
): Promise<string[]> {
  const tree = registries.get(registry);
  if (tree === undefined) {
    // Foreign registry — fall back to per-doc publish.
    const paths: string[] = [];
    for (const { doc, opts } of docs)
      paths.push(await registry.publish(doc, opts));
    return paths;
  }
  const paths: string[] = [];
  for (const { doc, opts } of docs) {
    paths.push(await writeResult(tree, doc, opts ?? {}));
  }
  await tree.finalize(message);
  return paths;
}

function createRegistry(tree: TreeStore): ArenaRegistry {
  return {
    async publish(result, opts = {}) {
      const rel = await writeResult(tree, result, opts);
      await tree.finalize(
        `arena: publish ${result.pack}/${result.agent}/${result.runId}`,
      );
      return rel;
    },
    async list(query = {}) {
      const out: ArenaResultV1[] = [];
      const index = await readIndex(tree);
      const packEntries =
        query.pack !== undefined
          ? ([[query.pack, indexPack(index, query.pack)]] as const)
          : Object.entries(index.packs);
      if (packEntries.some(([, v]) => v !== undefined)) {
        for (const [pack, entry] of packEntries) {
          if (entry === undefined) continue;
          for (const run of entry.runs) {
            const doc = tryParseResult(await tree.readFile(run.path));
            if (doc !== null && doc.pack === pack && matchesQuery(doc, query)) {
              out.push(doc);
            }
          }
        }
      } else {
        // No index — scan the results/ tree (fixture registries).
        for (const rel of await tree.listFiles("results/")) {
          if (!rel.endsWith(".json")) continue;
          const doc = tryParseResult(await tree.readFile(rel));
          if (doc !== null && matchesQuery(doc, query)) out.push(doc);
        }
      }
      out.sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
      return out;
    },
  };
}

/**
 * Rebuild index.json by scanning the results/ tree — the CI job that
 * denormalizes after publish pushes (`arena reindex`).
 */
export async function reindexRegistry(
  registry: ArenaRegistry,
): Promise<{ runs: number }> {
  const tree = registries.get(registry);
  if (tree === undefined) {
    throw new ArenaError(
      "reindex: registry was not created by @sverka/arena",
      "REGISTRY_UNAVAILABLE",
    );
  }
  const index: RegistryIndex = {
    schema: "arena.index/v1",
    updatedAt: "",
    packs: {},
  };
  let runs = 0;
  for (const rel of await tree.listFiles("results/")) {
    if (!rel.endsWith(".json")) continue;
    const doc = tryParseResult(await tree.readFile(rel));
    if (doc === null) continue;
    const parts = rel.split("/");
    const pack = indexPack(index, doc.pack) ?? { runs: [] };
    pack.runs.push({
      runId: doc.runId,
      agent: doc.agent,
      date: parts[3] ?? doc.startedAt.slice(0, 10),
      path: rel,
    });
    index.packs[doc.pack] = pack;
    runs++;
  }
  for (const pack of Object.values(index.packs)) {
    pack.runs.sort((a, b) =>
      a.date === b.date
        ? a.runId < b.runId
          ? -1
          : 1
        : a.date < b.date
          ? -1
          : 1,
    );
  }
  await writeIndex(tree, index);
  await tree.finalize("arena: reindex");
  return { runs };
}

/**
 * Resolve a registry reference to an ArenaRegistry:
 *   s3://bucket[/prefix]        → s3 backend
 *   file:///abs/path | ./dir    → file backend
 *   git::<url> | <git-url>      → git backend
 */
export function openRegistry(
  ref: string,
  opts: { token?: string; dir?: string; client?: S3ClientLike } = {},
): ArenaRegistry {
  if (ref.startsWith("s3://")) {
    const rest = ref.slice("s3://".length);
    const slash = rest.indexOf("/");
    const bucket = slash === -1 ? rest : rest.slice(0, slash);
    const prefix = slash === -1 ? undefined : rest.slice(slash + 1);
    return createS3Registry({
      bucket,
      ...(prefix !== undefined && prefix !== "" ? { prefix } : {}),
      ...(opts.client !== undefined ? { client: opts.client } : {}),
    });
  }
  const gitRef = ref.startsWith("git::") ? ref.slice(5) : ref;
  if (
    /^https?:\/\//.test(gitRef) ||
    /^git@/.test(gitRef) ||
    /^(?:ssh|git):\/\//.test(gitRef) ||
    gitRef.endsWith(".git")
  ) {
    return createGitRegistry({
      url: gitRef,
      ...(opts.token !== undefined ? { token: opts.token } : {}),
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
    });
  }
  const path = ref.startsWith("file://") ? ref.slice(7) : ref;
  return createFileRegistry(path);
}

/**
 * Resolve a registry ref to a local directory — file refs return their
 * path, git refs return the (cloned) checkout dir. s3 registries have no
 * local dir — callers that need one must error themselves.
 */
export async function resolveRegistryDir(
  ref: string,
  opts: { token?: string; dir?: string } = {},
): Promise<string> {
  if (ref.startsWith("s3://")) {
    throw new ArenaError(
      `s3 registry '${ref}' has no local directory`,
      "REGISTRY_UNAVAILABLE",
    );
  }
  const gitRef = ref.startsWith("git::") ? ref.slice(5) : ref;
  if (
    /^https?:\/\//.test(gitRef) ||
    /^git@/.test(gitRef) ||
    /^(?:ssh|git):\/\//.test(gitRef) ||
    gitRef.endsWith(".git")
  ) {
    const cfg: GitRegistryConfig = {
      url: gitRef,
      ...(opts.token !== undefined ? { token: opts.token } : {}),
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
    };
    await ensureGitCheckout(cfg);
    return gitRegistryDir(cfg);
  }
  const path = ref.startsWith("file://") ? ref.slice(7) : ref;
  return resolve(path);
}
