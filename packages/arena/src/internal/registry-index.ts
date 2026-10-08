/**
 * index.json machinery — the denormalized pack → runs index readers use
 * instead of scanning the results/ tree, plus the rebuild pass shared by
 * `reindex` and the git backend's index-conflict resolution.
 * Not exported from the package index.
 */
import { z } from "zod";

import { tryParseResult, type ArenaResultV1 } from "./arena-result.js";
import type { TreeStore } from "./tree-store.js";

export interface IndexRun {
  runId: string;
  agent: string;
  date: string;
  path: string;
}

export interface RegistryIndex {
  schema: "arena.index/v1";
  updatedAt: string;
  packs: Record<string, { runs: IndexRun[] }>;
}

export const INDEX_PATH = "index.json";

/** The shape resultPath emits — results/<pack>/<agent>/<YYYY-MM-DD>/<runId>.json. */
const RESULT_PATH =
  /^results\/[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*\/\d{4}-\d{2}-\d{2}\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/; // nosemgrep: rules_lgpl_javascript_dos_rule-regex-dos

const indexRunSchema = z.object({
  runId: z.string(),
  agent: z.string(),
  date: z.string(),
  // An index.json is untrusted input: a run path outside results/ would
  // make list() read a file outside the registry tree. A non-canonical
  // path fails the whole parse — readers fall back to a results/ scan,
  // writers rebuild the index.
  path: z.string().regex(RESULT_PATH),
});

const registryIndexSchema = z.object({
  schema: z.literal("arena.index/v1"),
  updatedAt: z.string(),
  packs: z.record(z.string(), z.object({ runs: z.array(indexRunSchema) })),
});

export function emptyIndex(): RegistryIndex {
  return { schema: "arena.index/v1", updatedAt: "", packs: {} };
}

/**
 * Parse index.json — null when it isn't a whole valid arena.index/v1
 * document (bad JSON, wrong schema, malformed pack entries). Callers
 * decide what corrupt means: readers fall back to a results/ scan,
 * writers rebuild the index.
 */
export function parseIndex(raw: string): RegistryIndex | null {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = registryIndexSchema.safeParse(doc);
  return parsed.success ? (parsed.data as RegistryIndex) : null;
}

export async function readIndex(tree: TreeStore): Promise<RegistryIndex> {
  const raw = await tree.readFile(INDEX_PATH);
  if (raw === null) return emptyIndex();
  // Corrupt reads as empty — safe for readers only: list falls back to
  // scanning results/. Writers must not share this shortcut (see
  // updateIndex).
  return parseIndex(raw) ?? emptyIndex();
}

export async function writeIndex(
  tree: TreeStore,
  index: RegistryIndex,
): Promise<void> {
  index.updatedAt = new Date().toISOString();
  await tree.writeFile(INDEX_PATH, JSON.stringify(index, null, 2) + "\n");
}

/** Own-property lookup — "constructor" is a valid pack name. */
export function indexPack(
  index: RegistryIndex,
  name: string,
): { runs: IndexRun[] } | undefined {
  return Object.hasOwn(index.packs, name) ? index.packs[name] : undefined;
}

export function compareIndexRuns(a: IndexRun, b: IndexRun): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.runId !== b.runId) return a.runId < b.runId ? -1 : 1;
  return 0;
}

export async function updateIndex(
  tree: TreeStore,
  doc: ArenaResultV1,
  relPath: string,
): Promise<void> {
  const raw = await tree.readFile(INDEX_PATH);
  // A corrupt index must not be treated as empty on the write path —
  // that would persist an index holding only this run, dropping every
  // earlier run from list/board until a manual reindex. Rebuild from
  // the results/ tree instead: it is the same denormalization reindex
  // runs, and the new result file is already written so the rebuild
  // covers it. A tree that can't be scanned fails REGISTRY_UNAVAILABLE
  // out of listFiles.
  const index =
    raw === null
      ? emptyIndex()
      : (parseIndex(raw) ?? (await buildIndex(tree)).index);
  const date = relPath.split("/")[3] ?? doc.startedAt.slice(0, 10);
  const pack = indexPack(index, doc.pack) ?? { runs: [] };
  pack.runs = [
    ...pack.runs.filter((r) => r.runId !== doc.runId),
    { runId: doc.runId, agent: doc.agent, date, path: relPath },
  ];
  pack.runs.sort(compareIndexRuns);
  index.packs[doc.pack] = pack;
  await writeIndex(tree, index);
}

/** Read and parse a batch of result files — fanned out, order preserved. */
export async function readResults(
  tree: TreeStore,
  paths: readonly string[],
): Promise<(ArenaResultV1 | null)[]> {
  return Promise.all(
    paths.map(async (rel) => tryParseResult(await tree.readFile(rel))),
  );
}

/**
 * Build index.json by scanning the results/ tree — the shared
 * denormalization pass behind `reindex` and the git backend's
 * index-conflict resolution.
 */
export async function buildIndex(
  tree: TreeStore,
): Promise<{ index: RegistryIndex; runs: number }> {
  const index: RegistryIndex = {
    schema: "arena.index/v1",
    updatedAt: "",
    packs: {},
  };
  const paths = (await tree.listFiles("results/")).filter((rel) =>
    rel.endsWith(".json"),
  );
  const docs = await readResults(tree, paths);
  for (const [i, doc] of docs.entries()) {
    if (doc === null) continue;
    const rel = paths[i]!;
    const parts = rel.split("/");
    const pack = indexPack(index, doc.pack) ?? { runs: [] };
    pack.runs.push({
      runId: doc.runId,
      agent: doc.agent,
      date: parts[3] ?? doc.startedAt.slice(0, 10),
      path: rel,
    });
    index.packs[doc.pack] = pack;
  }
  let runs = 0;
  for (const pack of Object.values(index.packs)) {
    // updateIndex keeps one entry per runId; a republish under another
    // partition leaves both files in results/, so the rebuild collapses
    // them too — the newest partition wins, path the tie-break.
    const byRun = new Map<string, IndexRun>();
    for (const run of pack.runs) {
      const prev = byRun.get(run.runId);
      if (
        prev === undefined ||
        run.date > prev.date ||
        (run.date === prev.date && run.path > prev.path)
      ) {
        byRun.set(run.runId, run);
      }
    }
    pack.runs = [...byRun.values()].sort(compareIndexRuns);
    runs += pack.runs.length;
  }
  return { index, runs };
}
