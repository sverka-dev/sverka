/**
 * Snapshot arena results for the /arena/ page.
 *
 * `sverka-arena run` writes `packages/arena/.arena/results.json` —
 * gitignored and hundreds of KB (full traces + agent output). This
 * script distils it into `src/data/arena-results.json`, which IS
 * committed: the page renders the snapshot, and refreshing it is a
 * deliberate local act (`bun run docs:arena` after a run), since CI
 * has no agent credentials.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const websiteDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(websiteDir);
const src = join(repoRoot, "packages", "arena", ".arena", "results.json");
const out = join(websiteDir, "src", "data", "arena-results.json");

interface ArenaAggregate {
  label: string;
  totalRuns: number;
  successCount: number;
  avgTotalTokens: number;
  avgToolCalls: number;
  avgLlmCalls: number;
  avgExecutionTimeMs: number;
}
interface ArenaComparison {
  baseline: string;
  candidate: string;
  deltaTokens: number;
  deltaToolCalls: number;
  deltaLlmCalls: number;
  deltaTimeMs: number;
  candidateBetter: boolean;
}
interface ArenaFile {
  timestamp: string;
  config?: {
    models?: (string | { id: string })[];
    plugins?: (string | { id: string })[];
    repetitions?: number;
  };
  aggregates?: ArenaAggregate[];
  analysis?: {
    taskId: string;
    taskName: string;
    comparisons?: ArenaComparison[];
  }[];
}

if (!existsSync(src)) {
  console.error(
    `no arena results at ${src} — run "bunx sverka-arena run" first`,
  );
  process.exit(1);
}

const raw = (await import(src, { with: { type: "json" } }))
  .default as ArenaFile;

const id = (m: string | { id: string }): string =>
  typeof m === "string" ? m : m.id;

const digest = {
  timestamp: raw.timestamp,
  commit: execSync("git rev-parse --short HEAD", {
    cwd: repoRoot,
    encoding: "utf-8",
  }).trim(),
  config: {
    models: (raw.config?.models ?? []).map(id),
    plugins: (raw.config?.plugins ?? []).map(id),
    repetitions: raw.config?.repetitions ?? 0,
  },
  aggregates: (raw.aggregates ?? []).map(
    ({
      label,
      totalRuns,
      successCount,
      avgTotalTokens,
      avgToolCalls,
      avgLlmCalls,
      avgExecutionTimeMs,
    }) => ({
      label,
      totalRuns,
      successCount,
      avgTotalTokens,
      avgToolCalls,
      avgLlmCalls,
      avgExecutionTimeMs,
    }),
  ),
  analysis: (raw.analysis ?? []).map(({ taskId, taskName, comparisons }) => ({
    taskId,
    taskName,
    comparisons: (comparisons ?? []).map(
      ({
        baseline,
        candidate,
        deltaTokens,
        deltaToolCalls,
        deltaLlmCalls,
        deltaTimeMs,
        candidateBetter,
      }) => ({
        baseline,
        candidate,
        deltaTokens,
        deltaToolCalls,
        deltaLlmCalls,
        deltaTimeMs,
        candidateBetter,
      }),
    ),
  })),
};

await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(digest, null, 2) + "\n");
console.log(
  `wrote ${out} — ${digest.aggregates.length} aggregates, ` +
    `${digest.analysis.length} task comparisons`,
);
