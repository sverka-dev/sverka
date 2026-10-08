/**
 * Leaderboard aggregation — groups published `arena.result/v1` documents
 * into cohorts keyed (pack, task, sverkaVersion, promptHash) and renders
 * one row per (agent, model). Results from different tasks, sverka
 * versions, or prompts never merge into one score.
 * Spec: specs/56-arena-eval-service.
 */
import type { ArenaResultV1 } from "./registry.js";

export interface BoardRow {
  readonly agent: string;
  readonly model: string;
  /** passed runs / total runs, 0..1 */
  readonly successRate: number;
  readonly medianTokens?: number;
  readonly medianDurationMs: number;
  readonly runs: number;
  /** Success rate per day for the last `days` days — NaN on days with no runs. */
  readonly trend: readonly number[];
}

export interface BoardCohort {
  readonly pack: string;
  readonly task: string;
  readonly sverkaVersion: string;
  readonly promptHash: string;
  readonly rows: readonly BoardRow[];
}

interface Sample {
  readonly day: string;
  readonly passed: boolean;
  readonly tokens?: number;
  readonly durationMs: number;
}

function median(xs: readonly number[]): number | undefined {
  if (xs.length === 0) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const TREND_DAYS = 30;

export interface BuildBoardOptions {
  /** Trend window length in days (default: 30). */
  days?: number;
  /** Anchor date for the trend window (default: the row's latest sample). */
  now?: Date;
}

/**
 * Aggregate published results into board cohorts. The cohort key is
 * (pack, task, sverkaVersion, promptHash) — a board row is only ever a
 * comparison inside one prompt+toolchain generation.
 */
export function buildBoard(
  results: readonly ArenaResultV1[],
  opts: BuildBoardOptions = {},
): BoardCohort[] {
  const days = opts.days ?? TREND_DAYS;
  const cohorts = new Map<
    string,
    {
      key: Omit<BoardCohort, "rows">;
      rows: Map<string, { agent: string; model: string; samples: Sample[] }>;
    }
  >();

  for (const doc of results) {
    const day = doc.startedAt.slice(0, 10);
    for (const t of doc.tasks) {
      const ck = `${doc.pack} ${t.task} ${doc.sverkaVersion} ${t.promptHash}`;
      let cohort = cohorts.get(ck);
      if (cohort === undefined) {
        cohort = {
          key: {
            pack: doc.pack,
            task: t.task,
            sverkaVersion: doc.sverkaVersion,
            promptHash: t.promptHash,
          },
          rows: new Map(),
        };
        cohorts.set(ck, cohort);
      }
      const rk = `${doc.agent} ${doc.model}`;
      let row = cohort.rows.get(rk);
      if (row === undefined) {
        row = { agent: doc.agent, model: doc.model, samples: [] };
        cohort.rows.set(rk, row);
      }
      row.samples.push({
        day,
        passed: t.score.passed,
        ...(t.metrics.tokens !== undefined ? { tokens: t.metrics.tokens } : {}),
        durationMs: t.metrics.durationMs,
      });
    }
  }

  const out: BoardCohort[] = [];
  for (const { key, rows } of cohorts.values()) {
    const boardRows: BoardRow[] = [...rows.values()].map((r) => {
      const n = r.samples.length;
      const passes = r.samples.filter((s) => s.passed).length;
      const anchor =
        opts.now !== undefined
          ? isoDay(opts.now)
          : r.samples.reduce(
              (max, s) => (s.day > max ? s.day : max),
              "0000-00-00",
            );
      const byDay = new Map<string, { pass: number; n: number }>();
      for (const s of r.samples) {
        const d = byDay.get(s.day) ?? { pass: 0, n: 0 };
        d.n++;
        if (s.passed) d.pass++;
        byDay.set(s.day, d);
      }
      const trend: number[] = [];
      const anchorDate = new Date(`${anchor}T00:00:00.000Z`);
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(anchorDate.getTime() - i * 86_400_000);
        const stat = byDay.get(isoDay(d));
        trend.push(stat === undefined ? Number.NaN : stat.pass / stat.n);
      }
      const tokens = median(
        r.samples.flatMap((s) => (s.tokens !== undefined ? [s.tokens] : [])),
      );
      return {
        agent: r.agent,
        model: r.model,
        successRate: n === 0 ? 0 : passes / n,
        ...(tokens !== undefined ? { medianTokens: tokens } : {}),
        medianDurationMs: median(r.samples.map((s) => s.durationMs)) ?? 0,
        runs: n,
        trend,
      };
    });
    boardRows.sort(
      (a, b) =>
        b.successRate - a.successRate ||
        (a.medianTokens ?? Infinity) - (b.medianTokens ?? Infinity) ||
        a.agent.localeCompare(b.agent) ||
        a.model.localeCompare(b.model),
    );
    out.push({ ...key, rows: boardRows });
  }
  out.sort(
    (a, b) =>
      a.pack.localeCompare(b.pack) ||
      a.task.localeCompare(b.task) ||
      a.sverkaVersion.localeCompare(b.sverkaVersion) ||
      a.promptHash.localeCompare(b.promptHash),
  );
  return out;
}

// ─── Text render ─────────────────────────────────────────────────────

const SPARK = "▁▂▃▄▅▆▇█";

/** Sparkline over the trend array — NaN days render as a gap dot. */
export function sparkline(trend: readonly number[]): string {
  return trend
    .map((v) =>
      Number.isNaN(v)
        ? "·"
        : SPARK[
            Math.min(
              SPARK.length - 1,
              Math.max(0, Math.round(v * (SPARK.length - 1))),
            )
          ],
    )
    .join("");
}

function formatTokens(n: number | undefined): string {
  if (n === undefined) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n));
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function cohortTitle(c: BoardCohort): string {
  return `${c.pack} · ${c.task} · sverka ${c.sverkaVersion} · prompt ${c.promptHash.slice(0, 12)}`;
}

/** Render the leaderboard as a text table — `sverka-arena board`. */
export function renderBoard(cohorts: readonly BoardCohort[]): string {
  if (cohorts.length === 0) {
    return "no arena results — nothing published to this registry yet";
  }
  const out: string[] = [];
  for (const c of cohorts) {
    out.push(cohortTitle(c));
    const header = [
      "AGENT",
      "MODEL",
      "SUCCESS",
      "MED-TOK",
      "MED-DUR",
      "RUNS",
      "TREND",
    ];
    const lines = c.rows.map((r) => [
      r.agent,
      r.model,
      `${(r.successRate * 100).toFixed(1)}%`,
      formatTokens(r.medianTokens),
      formatDuration(r.medianDurationMs),
      String(r.runs),
      sparkline(r.trend),
    ]);
    const widths = header.map((h, i) =>
      Math.max(h.length, ...lines.map((l) => l[i]!.length)),
    );
    const fmt = (cells: readonly string[]): string =>
      cells
        .map((cell, i) => cell.padEnd(widths[i]!))
        .join("  ")
        .trimEnd();
    out.push(`  ${fmt(header)}`);
    for (const l of lines) out.push(`  ${fmt(l)}`);
    out.push("");
  }
  return out.join("\n").trimEnd();
}

// ─── HTML render ─────────────────────────────────────────────────────

function rateClass(successRate: number): string {
  if (successRate >= 0.99) return "ok";
  if (successRate >= 0.5) return "mid";
  return "bad";
}

function esc(s: string): string {
  return s
    .replaceAll(/&/g, "&amp;")
    .replaceAll(/</g, "&lt;")
    .replaceAll(/>/g, "&gt;")
    .replaceAll(/"/g, "&quot;");
}

/**
 * Render the leaderboard as a self-contained static HTML page — no JS,
 * no server. Used by `sverka-arena board --format html` and the website
 * arena page (generated at build time from the registry).
 */
export function renderBoardHtml(
  cohorts: readonly BoardCohort[],
  opts: { title?: string; generatedAt?: string } = {},
): string {
  const title = opts.title ?? "Sverka Arena — Leaderboard";
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const sections = cohorts
    .map((c) => {
      const rows = c.rows
        .map((r) => {
          const spark = esc(sparkline(r.trend));
          return `        <tr>
          <td>${esc(r.agent)}</td>
          <td>${esc(r.model)}</td>
          <td class="num ${rateClass(r.successRate)}">${(r.successRate * 100).toFixed(1)}%</td>
          <td class="num">${formatTokens(r.medianTokens)}</td>
          <td class="num">${formatDuration(r.medianDurationMs)}</td>
          <td class="num">${r.runs}</td>
          <td class="spark" title="daily success rate, last ${r.trend.length} days">${spark}</td>
        </tr>`;
        })
        .join("\n");
      return `      <section class="cohort">
        <h2>${esc(cohortTitle(c))}</h2>
        <table>
          <thead><tr><th>agent</th><th>model</th><th class="num">success</th><th class="num">med&nbsp;tokens</th><th class="num">med&nbsp;duration</th><th class="num">runs</th><th>trend</th></tr></thead>
          <tbody>
${rows}
          </tbody>
        </table>
      </section>`;
    })
    .join("\n");
  const body =
    cohorts.length === 0
      ? `      <p class="empty">no arena results — nothing published to this registry yet</p>`
      : sections;
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
:root {
  --bg: #0d1117; --surface: #161b22; --border: #30363d;
  --text: #e6edf3; --text-muted: #8b949e;
  --green: #3fb950; --yellow: #d29922; --red: #f85149; --accent: #58a6ff;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  background: var(--bg); color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  line-height: 1.6; padding: 2rem; max-width: 1100px; margin: 0 auto;
}
h1 { font-size: 1.4rem; }
.subtitle { color: var(--text-muted); font-size: 0.85rem; margin: 0.25rem 0 1.5rem; }
.cohort {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1.25rem;
}
.cohort h2 {
  font-size: 0.95rem; font-family: ui-monospace, "SF Mono", monospace;
  color: var(--accent); margin-bottom: 0.75rem; font-weight: 600;
}
table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
th {
  text-align: left; color: var(--text-muted); font-weight: 600;
  font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em;
  padding: 0.3rem 0.6rem; border-bottom: 1px solid var(--border);
}
td { padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--border); }
tr:last-child td { border-bottom: none; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
th.num { text-align: right; }
.ok { color: var(--green); } .mid { color: var(--yellow); } .bad { color: var(--red); }
.spark { font-family: ui-monospace, "SF Mono", monospace; letter-spacing: 0.05em; color: var(--green); }
.empty { color: var(--text-muted); padding: 3rem 0; text-align: center; }
footer { color: var(--text-muted); font-size: 0.75rem; margin-top: 2rem; }
</style>
</head>
<body>
  <h1>${esc(title)}</h1>
  <p class="subtitle">verification-grounded agent evals — cohorts are (pack · task · sverka version · prompt hash); rows compare agent×model inside one cohort only</p>
${body}
  <footer>generated ${esc(generatedAt)} — deterministic checks as ground truth, no LLM judge</footer>
</body>
</html>
`;
}
