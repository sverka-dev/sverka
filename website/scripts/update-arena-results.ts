/**
 * Refresh the benchmark app's static snapshot for /benchmark/.
 *
 * The arena workbench (public/benchmark/) is a static SPA on GitHub
 * Pages — the live CRUD server only exists locally. So the real data
 * must be committed:
 *
 *   - packages/arena/.arena/results.json → public/benchmark/arena-results.json
 *     (the SPA's default data source; full ArenaResult shape)
 *   - packages/arena/arena.config.ts tasks → public/benchmark/api/cases.json
 *   - packages/arena/arena.config.ts models/plugins → api/config.json
 *
 *   - per-run sverka reports → traces/<taskId>/<combo>.report.html
 *     (the same @sverka/reporter Gantt/DAG as pipeline reports —
 *     dogfooding the report on agent traces)
 *
 * Refresh after a local `sverka-arena run`: `bun run docs:arena`
 * (needs `bun run build` first — imports @sverka/arena dist).
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// Source import — website/ is not an npm workspace member, so
// @sverka/arena isn't resolvable by name. Bun runs TS directly;
// the module's own @sverka/* imports resolve via arena's deps (dist,
// so `bun run build` must have run at least once).
import type {
  ArenaResult,
  RunResult,
  TraceData,
  TraceStep,
} from "../../packages/arena/src/types.js";
import { writeTraceReport } from "../../packages/arena/src/trace-report.js";
import { writeAggregateReport } from "../../packages/arena/src/aggregate-report.js";

// Committed traces are public artifacts — strip host/session specifics
// (absolute paths, kernel build, session ids) and drop replayed context:
// the emitter re-sends earlier steps on each flush, so identical stepIds
// accumulate 2-6x in the raw trace.
function redactText(text: string): string {
  return (
    text
      .replace(/\/home\/[^\s"']+/g, "/home/user")
      .replace(/\/tmp\/[^\s"']+/g, "/tmp/sandbox")
      .replace(/OS Version: [^\n<]+/g, "OS Version: linux")
      // TLD must be ≥2 letters — otherwise package specifiers like
      // `cli@0.1.29` get mangled into `[email]`.
      .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-zA-Z]{2,}\b/g, "[email]")
      .replace(
        /(bearer|token|api[_-]?key|secret)[=:]\s*["']?[\w.-]+/gi,
        "$1=[redacted]",
      )
  );
}

const SENSITIVE_KEY = /key|token|secret|password|credential|auth/i;

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value !== null && typeof value === "object") {
    // Credential-bearing fields are redacted by key regardless of value
    // shape — { "apiKey": "sk-..." } survives value-only scrubbing.
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        SENSITIVE_KEY.test(k) ? "[redacted]" : redactValue(v),
      ]),
    );
  }
  return value;
}

function sanitizeTrace(trace: TraceData): TraceData {
  const byStep = new Map<number, TraceStep>();
  for (const step of trace.steps) byStep.set(step.stepId, step);
  return {
    ...trace,
    sessionId: "redacted",
    steps: [...byStep.values()].map((s) => ({
      ...s,
      message: redactText(s.message),
      ...(s.toolCalls
        ? {
            toolCalls: s.toolCalls.map((c) => ({
              ...c,
              arguments: redactValue(c.arguments) as Record<string, unknown>,
            })),
          }
        : {}),
      ...(s.observations
        ? {
            observations: s.observations.map((o) => ({
              ...o,
              content: redactText(o.content),
            })),
          }
        : {}),
    })),
  };
}

const websiteDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(websiteDir);
const arenaDir = join(repoRoot, "packages", "arena");
const resultsSrc = join(arenaDir, ".arena", "results.json");
const benchDir = join(websiteDir, "public", "benchmark");
const apiDir = join(benchDir, "api");

interface ArenaTask {
  id: string;
  name: string;
  prompt: string;
  fixture?: string;
  timeoutMs?: number;
  setup?: string[];
  successCriteria?: string;
  checks?: { id: string; command: string; description: string }[];
}
// Typed as RunResult but trace is treated as optional — a hand-edited
// snapshot may drop it, and reports/traces just skip those entries.
type ArenaResultsFile = Partial<ArenaResult> & { results?: RunResult[] };
interface ArenaConfigFile {
  models?: { id: string; name: string; envVar?: string }[];
  plugins?: { id: string; name: string; path?: string }[];
  judge?: {
    model: { id: string };
    revealPlugins: boolean;
    repetitions: number;
  };
  repetitions?: number;
  tasks?: ArenaTask[];
}

if (!existsSync(resultsSrc)) {
  console.error(
    `no arena results at ${resultsSrc} — run "bunx sverka-arena run" first`,
  );
  process.exit(1);
}

const config = (await import(join(arenaDir, "arena.config.ts")))
  .default as ArenaConfigFile;

const results = JSON.parse(
  readFileSync(resultsSrc, "utf-8"),
) as ArenaResultsFile;

// Guard against shipping a snapshot whose task ids don't exist in the
// current arena config — cases.json is regenerated from it, so unknown
// task ids would render without their case metadata.
const configTaskIds = new Set((config.tasks ?? []).map((t) => t.id));
const strayIds = [
  ...new Set((results.results ?? []).map((r) => r.taskId)),
].filter((id) => !configTaskIds.has(id));
if (strayIds.length > 0) {
  console.error(
    `results.json references tasks absent from arena.config.ts: ${strayIds.join(", ")}`,
  );
  process.exit(1);
}

await mkdir(apiDir, { recursive: true });

// Atomic write — a torn api/*.json would break the static snapshot.
async function writeJson(path: string, data: unknown): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n");
  await rename(tmp, path);
}

// Per-combo artifacts — trace.html loads
// traces/<taskId>/<plugins.join("--") | "no-plugins">.json, run cards
// link traces/<taskId>/<combo>.report.html.
// Two passes: generate everything to .tmp first, then rename the whole
// batch, then results.json last — a render failure can never leave the
// SPA pointing at a partial generation.
const tracesDir = join(benchDir, "traces");
const staged: [tmp: string, target: string][] = [];
for (const r of results.results ?? []) {
  if (!r.trace) continue;
  const combo = r.pluginIds.length ? r.pluginIds.join("--") : "no-plugins";
  const dir = join(tracesDir, r.taskId);
  await mkdir(dir, { recursive: true });
  // Later repetitions overwrite — the viewer only shows one run per combo.
  const tracePath = join(dir, `${combo}.json`);
  const traceTmp = `${tracePath}.tmp`;
  // trace.html reads per-config data from a `configs` map keyed by
  // combo label ("raw"/"sverka"/...) — llmCallCount lives on
  // RunResult.metrics, not inside TraceData, so copy it across.
  const comboLabel = r.pluginIds.length ? r.pluginIds.join("+") : "raw";
  const traceJson = {
    configs: {
      [comboLabel]: {
        ...sanitizeTrace(r.trace),
        llmCallCount: r.metrics?.llmCallCount ?? 0,
      },
    },
  };
  await writeFile(traceTmp, JSON.stringify(traceJson, null, 2) + "\n");
  staged.push([traceTmp, tracePath]);
  // Sverka report — Gantt/DAG timeline of the agent run itself. The
  // report embeds the trace, so render it from the sanitized clone too.
  const reportPath = join(dir, `${combo}.report.html`);
  const reportTmp = `${reportPath}.tmp`;
  writeTraceReport({ ...r, trace: sanitizeTrace(r.trace) }, reportTmp);
  staged.push([reportTmp, reportPath]);
}
const reportsWritten = staged.length / 2;
for (const [tmp, target] of staged) {
  await rename(tmp, target);
}
// Older trace dirs stay — arena-sample.json still references them.

// Aggregate report — the whole matrix as one sverka report (pipeline per
// task, run per step). Same tmp+rename discipline as the trace reports.
const cfg = results.config;
const arenaResult =
  cfg !== undefined &&
  Array.isArray(cfg.models) &&
  Array.isArray(cfg.plugins) &&
  Array.isArray(cfg.tasks)
    ? ({ ...results, results: results.results ?? [] } as ArenaResult)
    : undefined;
const aggPath = join(benchDir, "aggregate.html");
if (arenaResult !== undefined) {
  const aggTmp = `${aggPath}.tmp`;
  writeAggregateReport(arenaResult, aggTmp);
  await rename(aggTmp, aggPath);
} else if (existsSync(aggPath)) {
  // Snapshot lost its usable config — don't leave a stale report behind.
  await rm(aggPath);
}

// Results — the SPA's default data file. Traces get the same public
// sanitization as the per-run files; a torn file must never reach the
// page, so write via tmp+rename.
const sanitizedResults = {
  ...results,
  results: (results.results ?? []).map((r) => ({
    ...r,
    // output/checkResults/verdicts carry recorded commands and tool
    // output — same host path + secret leakage surface as the trace.
    ...(typeof r.output === "string" ? { output: redactText(r.output) } : {}),
    ...(r.checkResults
      ? {
          checkResults: r.checkResults.map((c) => ({
            ...c,
            output: redactText(c.output),
          })),
        }
      : {}),
    ...(r.verdicts
      ? {
          verdicts: r.verdicts.map(
            (v) => redactValue(v) as (typeof r.verdicts)[number],
          ),
        }
      : {}),
    ...(r.trace ? { trace: sanitizeTrace(r.trace) } : {}),
  })),
};
const resultsTmp = join(benchDir, "arena-results.json.tmp");
await writeFile(resultsTmp, JSON.stringify(sanitizedResults, null, 2) + "\n");
await rename(resultsTmp, join(benchDir, "arena-results.json"));

// Cases — task definitions, preserving createdAt for existing ids.
const casesPath = join(apiDir, "cases.json");
const oldCases: { id: string; createdAt?: string; updatedAt?: string }[] =
  existsSync(casesPath)
    ? (JSON.parse(readFileSync(casesPath, "utf-8")) as {
        id: string;
        createdAt?: string;
        updatedAt?: string;
      }[])
    : [];
const oldById = new Map(oldCases.map((c) => [c.id, c]));
const now = new Date().toISOString();
const cases = (config.tasks ?? []).map((t) => {
  const base = {
    id: t.id,
    name: t.name,
    prompt: t.prompt,
    ...(t.successCriteria ? { successCriteria: t.successCriteria } : {}),
    ...(t.fixture ? { fixture: t.fixture } : {}),
    ...(t.timeoutMs ? { timeoutMs: t.timeoutMs } : {}),
    ...(t.setup ? { setup: t.setup } : {}),
    ...(t.checks ? { checks: t.checks } : {}),
  };
  const old = oldById.get(t.id);
  const {
    createdAt: oldCreated,
    updatedAt: oldUpdated,
    ...oldRest
  } = old ?? {};
  // updatedAt only advances when the case content actually changed —
  // otherwise every refresh claims all cases were recently edited.
  const unchanged =
    old !== undefined && JSON.stringify(oldRest) === JSON.stringify(base);
  return {
    ...base,
    createdAt: oldCreated ?? now,
    updatedAt: unchanged ? (oldUpdated ?? now) : now,
  };
});
await writeJson(casesPath, cases);

// Config — models + plugins (no secrets; ids/names only).
await writeJson(join(apiDir, "config.json"), {
  models: config.models ?? [],
  plugins: config.plugins ?? [],
  ...(config.judge ? { judge: config.judge } : {}),
  repetitions: config.repetitions ?? 1,
});

console.log(
  `snapshot updated: arena-results.json (${Math.round(
    readFileSync(resultsSrc).length / 1024,
  )}KB), ${cases.length} cases, ${config.models?.length ?? 0} models, ${reportsWritten} sverka reports`,
);
