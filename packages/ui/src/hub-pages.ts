// @sverka/ui — hub dashboard pages (Spec 55): run list, run detail,
// findings trend, flaky-step view. Server-rendered static HTML reusing
// the dashboard's dark theme; findings render via
// @sverka/sarif-viewer-web's generateSarifHtml (served as a sub-document
// and embedded via <iframe>).

import { escapeHtml, pageShell } from "./escape.js";

/** A run summary row as the hub serves it (mirrors HubRunSummary). */
export interface HubRunRow {
  readonly runId: string;
  readonly project: string;
  readonly entry: string;
  readonly status: string;
  readonly startedAt: number | null;
  readonly durationMs: number | null;
  readonly findingCounts: {
    readonly total: number;
    readonly bySeverity: Record<string, number>;
  };
  readonly policyVerdict?: string | null;
}

/** A stored run detail (report payload + findings). */
export interface HubRunView extends HubRunRow {
  readonly report: Record<string, unknown>;
  readonly findings: readonly unknown[];
  readonly uploadedAt: number;
}

/** A flaky-step aggregate row (GET /v1/flaky). */
export interface HubFlakyRow {
  readonly stepId: string;
  readonly successRate: number;
  readonly runs: number;
}

function formatTs(epochMs: number | null): string {
  if (epochMs === null) return "—";
  return new Date(epochMs).toISOString().replace("T", " ").slice(0, 19) + "Z";
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function statusCell(status: string): string {
  const cls =
    status === "success" ? "ok" : status === "failure" ? "fail" : "warn";
  return `<span class="${cls}">${escapeHtml(status)}</span>`;
}

function runUrl(project: string, runId: string): string {
  return `/runs/${encodeURIComponent(project)}/${encodeURIComponent(runId)}`;
}

function severityBadges(counts: Record<string, number>): string {
  return (["critical", "high", "medium", "low", "info"] as const)
    .filter((sev) => (counts[sev] ?? 0) > 0)
    .map(
      (sev) =>
        `<span class="${sev === "critical" || sev === "high" ? "fail" : sev === "medium" ? "warn" : "muted"}">${sev}:${counts[sev]}</span>`,
    )
    .join(" ");
}

/**
 * Run list page — one row per stored run for a project, newest first.
 */
export function renderHubRunList(opts: {
  readonly project: string;
  readonly runs: readonly HubRunRow[];
}): string {
  const rows =
    opts.runs.length === 0
      ? `<p class="empty">No runs recorded for <code>${escapeHtml(opts.project)}</code>. Run <code>sverka run --remote</code> to upload one.</p>`
      : `<table>
  <thead><tr><th>Run</th><th>Entry</th><th>Status</th><th>Started</th><th>Duration</th><th>Findings</th><th>Verdict</th></tr></thead>
  <tbody>
    ${opts.runs
      .map(
        (r) => `<tr>
      <td><a href="${runUrl(r.project, r.runId)}"><code>${escapeHtml(r.runId)}</code></a></td>
      <td>${escapeHtml(r.entry)}</td>
      <td>${statusCell(r.status)}</td>
      <td class="muted">${formatTs(r.startedAt)}</td>
      <td class="muted">${formatDuration(r.durationMs)}</td>
      <td>${r.findingCounts.total} ${severityBadges(r.findingCounts.bySeverity)}</td>
      <td>${r.policyVerdict != null ? statusCell(r.policyVerdict) : '<span class="muted">—</span>'}</td>
    </tr>`,
      )
      .join("\n    ")}
  </tbody>
</table>`;
  return pageShell({
    title: `Runs — ${opts.project}`,
    subtitle: `<code>${escapeHtml(opts.project)}</code>`,
    nav: [
      { href: "/", label: "projects" },
      {
        href: `/flaky/${encodeURIComponent(opts.project)}`,
        label: "flaky steps",
      },
    ],
    body: `<h2>Recent runs</h2>${rows}`,
  });
}

interface ReportStep {
  readonly stepId?: unknown;
  readonly status?: unknown;
  readonly durationMs?: unknown;
  readonly error?: unknown;
  readonly cacheKey?: unknown;
}

/** Steps table from a sverka.run/v1 report payload. */
function stepsTable(report: Record<string, unknown>): string {
  const data = report["data"];
  const steps =
    typeof data === "object" && data !== null
      ? (data as { steps?: readonly ReportStep[] }).steps
      : undefined;
  if (!Array.isArray(steps) || steps.length === 0) return "";
  const rows = steps
    .map((s) => {
      const stepId = typeof s.stepId === "string" ? s.stepId : "?";
      const status = typeof s.status === "string" ? s.status : "?";
      const duration =
        typeof s.durationMs === "number" ? formatDuration(s.durationMs) : "—";
      const detail =
        typeof s.error === "string"
          ? s.error
          : typeof s.cacheKey === "string"
            ? `cache: ${s.cacheKey}`
            : "";
      return `<tr><td><code>${escapeHtml(stepId)}</code></td><td>${statusCell(status)}</td><td class="muted">${duration}</td><td class="muted">${escapeHtml(detail)}</td></tr>`;
    })
    .join("\n    ");
  return `<h2>Steps</h2><table>
  <thead><tr><th>Step</th><th>Status</th><th>Duration</th><th>Detail</th></tr></thead>
  <tbody>
    ${rows}
  </tbody>
</table>`;
}

/**
 * Run detail page — run metadata + per-step table + findings embedded
 * via the SARIF report renderer (iframe to the findings sub-document).
 */
export function renderHubRunDetail(opts: { readonly run: HubRunView }): string {
  const { run } = opts;
  const findingsBlock =
    run.findings.length === 0
      ? `<p class="empty">No findings in this run.</p>`
      : `<iframe class="findings" src="${runUrl(run.project, run.runId)}/findings" title="Findings"></iframe>`;
  return pageShell({
    title: `Run ${run.runId}`,
    subtitle: `<code>${escapeHtml(run.project)}</code> · ${escapeHtml(run.entry)} · ${formatTs(run.startedAt)}`,
    nav: [
      { href: `/?project=${encodeURIComponent(run.project)}`, label: "runs" },
      {
        href: `/flaky/${encodeURIComponent(run.project)}`,
        label: "flaky steps",
      },
    ],
    body: `
<h2>Summary</h2>
<table>
  <tbody>
    <tr><th>Status</th><td>${statusCell(run.status)}</td></tr>
    <tr><th>Duration</th><td>${formatDuration(run.durationMs)}</td></tr>
    <tr><th>Findings</th><td>${run.findingCounts.total} ${severityBadges(run.findingCounts.bySeverity)}</td></tr>
    ${run.policyVerdict != null ? `<tr><th>Verdict</th><td>${statusCell(run.policyVerdict)}</td></tr>` : ""}
    <tr><th>Uploaded</th><td class="muted">${formatTs(run.uploadedAt)}</td></tr>
  </tbody>
</table>
${stepsTable(run.report)}
<h2>Findings</h2>
${findingsBlock}`,
  });
}

/**
 * Flaky-step view — per-step success rate across the last N runs,
 * worst first. Rows come from `GET /v1/flaky/{project}`.
 */
export function renderHubFlaky(opts: {
  readonly project: string;
  readonly rows: readonly HubFlakyRow[];
  readonly window: number;
}): string {
  const body =
    opts.rows.length === 0
      ? `<p class="empty">No step data over the last ${opts.window} runs for <code>${escapeHtml(opts.project)}</code>.</p>`
      : `<table>
  <thead><tr><th>Step</th><th>Success rate</th><th>Runs</th></tr></thead>
  <tbody>
    ${opts.rows
      .map(
        (r) => `<tr>
      <td><code>${escapeHtml(r.stepId)}</code></td>
      <td class="${r.successRate < 0.9 ? "fail" : r.successRate < 1 ? "warn" : "ok"}">${(r.successRate * 100).toFixed(1)}%</td>
      <td class="muted">${r.runs}</td>
    </tr>`,
      )
      .join("\n    ")}
  </tbody>
</table>`;
  return pageShell({
    title: `Flaky steps — ${opts.project}`,
    subtitle: `last ${opts.window} runs`,
    nav: [
      { href: `/?project=${encodeURIComponent(opts.project)}`, label: "runs" },
    ],
    body,
  });
}

/**
 * Projects index — links to each project's run list.
 */
export function renderHubIndex(opts: {
  readonly projects: readonly string[];
}): string {
  const body =
    opts.projects.length === 0
      ? `<p class="empty">No runs recorded yet. Point a checkout at this hub and run <code>sverka run --remote</code>.</p>`
      : `<table>
  <thead><tr><th>Project</th></tr></thead>
  <tbody>
    ${opts.projects
      .map(
        (p) =>
          `<tr><td><a href="/?project=${encodeURIComponent(p)}"><code>${escapeHtml(p)}</code></a></td></tr>`,
      )
      .join("\n    ")}
  </tbody>
</table>`;
  return pageShell({
    title: "Sverka Hub",
    subtitle: "Remote run hub — cache, history, findings",
    body: `<h2>Projects</h2>${body}`,
  });
}
