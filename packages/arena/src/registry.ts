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
 *
 * Layout: the document schema lives in internal/arena-result.ts, the
 * index machinery in internal/registry-index.ts, and each backend's
 * TreeStore in internal/{tree-store,git-backend,s3-backend}.ts.
 */
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { ArenaError } from "./config.js";
import {
  checkSegment,
  parseArenaResultV1,
  resultPath,
  type ArenaResultV1,
} from "./internal/arena-result.js";
import {
  createGitTree,
  ensureGitCheckout,
  gitRegistryDir,
  type GitRegistryConfig,
} from "./internal/git-backend.js";
import {
  buildIndex,
  indexPack,
  readIndex,
  readResults,
  updateIndex,
  writeIndex,
} from "./internal/registry-index.js";
import {
  createS3Tree,
  type S3ClientLike,
  type S3RegistryConfig,
} from "./internal/s3-backend.js";
import { createFileTree, type TreeStore } from "./internal/tree-store.js";

// Re-exported so the public surface stays `registry.js` — see index.ts.
export {
  arenaResultV1Schema,
  parseArenaResultV1,
  promptHash,
  resultPath,
} from "./internal/arena-result.js";
export type { ArenaResultV1, TaskResult } from "./internal/arena-result.js";
export type { GitRegistryConfig } from "./internal/git-backend.js";
export type { S3ClientLike, S3RegistryConfig } from "./internal/s3-backend.js";

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

const registries = new WeakMap<ArenaRegistry, TreeStore>();

// ─── Backend factories ───────────────────────────────────────────────

export function createGitRegistry(cfg: GitRegistryConfig): ArenaRegistry {
  const tree = createGitTree(cfg);
  const registry = createRegistry(tree);
  registries.set(registry, tree);
  return registry;
}

export function createS3Registry(cfg: S3RegistryConfig): ArenaRegistry {
  const tree = createS3Tree(cfg);
  const registry = createRegistry(tree);
  registries.set(registry, tree);
  return registry;
}

/** Registry over a local directory — a git checkout or a plain tree. */
export function createFileRegistry(dir: string): ArenaRegistry {
  const tree = createFileTree(resolve(dir));
  const registry = createRegistry(tree);
  registries.set(registry, tree);
  return registry;
}

// ─── Generic registry over a tree ────────────────────────────────────

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

/** One trace payload → its traces/<runId>/<name> write. */
async function writeTrace(
  tree: TreeStore,
  runId: string,
  trace: TraceInput,
): Promise<void> {
  const name =
    typeof trace === "string" ? basename(trace) : basename(trace.name);
  checkSegment(name.replace(/\.[^.]+$/, ""), "trace name");
  const data =
    typeof trace === "string"
      ? await readFile(trace, "utf8")
      : JSON.stringify(trace.data) + "\n"; // single-line — .trace.jsonl stays valid JSONL
  await tree.writeFile(`traces/${runId}/${name}`, data);
}

async function writeResult(
  tree: TreeStore,
  doc: ArenaResultV1,
  opts: PublishOptions,
): Promise<string> {
  const valid = parseArenaResultV1(doc);
  const rel = resultPath(valid, opts.date);
  await tree.writeFile(rel, JSON.stringify(valid, null, 2) + "\n");
  // Trace writes are independent per file — fanned out.
  await Promise.all(
    (opts.traces ?? []).map((trace) => writeTrace(tree, valid.runId, trace)),
  );
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
  const paths: string[] = [];
  if (tree === undefined) {
    // Foreign registry — fall back to per-doc publish. Sequential on
    // purpose: a foreign publish contract isn't known to be
    // concurrency-safe, and doc order is the caller's order.
    for (const { doc, opts } of docs) {
      paths.push(await registry.publish(doc, opts)); // NOSONAR — see above
    }
    return paths;
  }
  // Sequential on purpose: writeResult's index update is a
  // read-modify-write of index.json — concurrent writes would race.
  for (const { doc, opts } of docs) {
    paths.push(await writeResult(tree, doc, opts ?? {})); // NOSONAR — see above
  }
  await tree.finalize(message);
  return paths;
}

function createRegistry(tree: TreeStore): ArenaRegistry {
  return {
    async publish(result, opts = {}) {
      // No refresh here: publishing off a stale checkout surfaces
      // same-path rewrites as a rebase conflict (REGISTRY_UNAVAILABLE)
      // rather than silently last-writer-wins.
      const rel = await writeResult(tree, result, opts);
      await tree.finalize(
        `arena: publish ${result.pack}/${result.agent}/${result.runId}`,
      );
      return rel;
    },
    async list(query = {}) {
      await tree.refresh?.();
      const index = await readIndex(tree);
      const packEntries =
        query.pack !== undefined
          ? ([[query.pack, indexPack(index, query.pack)]] as const)
          : Object.entries(index.packs);
      if (!packEntries.some(([, v]) => v !== undefined)) {
        // No index — scan the results/ tree (fixture registries).
        const paths = (await tree.listFiles("results/")).filter((rel) =>
          rel.endsWith(".json"),
        );
        const docs = await readResults(tree, paths);
        return docs
          .filter(
            (doc): doc is ArenaResultV1 =>
              doc !== null && matchesQuery(doc, query),
          )
          .sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
      }
      // Result reads are independent — fanned out per pack, order kept.
      const perPack = await Promise.all(
        packEntries.map(async ([pack, entry]) => {
          if (entry === undefined) return [];
          const docs = await readResults(
            tree,
            entry.runs.map((r) => r.path),
          );
          return docs.filter(
            (doc): doc is ArenaResultV1 =>
              doc !== null && doc.pack === pack && matchesQuery(doc, query),
          );
        }),
      );
      return perPack
        .flat()
        .sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
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
  // Re-sync first — a memoized checkout would index a stale tree.
  await tree.refresh?.();
  const { index, runs } = await buildIndex(tree);
  await writeIndex(tree, index);
  await tree.finalize("arena: reindex");
  return { runs };
}

/** True when ref names a git remote (http/ssh/git@/.git suffix). */
function isGitRef(ref: string): boolean {
  return (
    /^https?:\/\//.test(ref) ||
    ref.startsWith("git@") ||
    /^(?:ssh|git):\/\//.test(ref) ||
    ref.endsWith(".git")
  );
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
  if (isGitRef(gitRef)) {
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
  if (isGitRef(gitRef)) {
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
