// @sverka/reporter — HtmlRenderer (I/O). Spec 44, 51.

import type { RunEvent } from "@sverka/runtime";
import type { Finding, PolicyResult } from "@sverka/verification";
import type {
  Renderer,
  UIState,
  StepUIState,
  HtmlRendererOptions,
  ReportContext,
} from "./types.js";
import { createInitialState, reduceEvent } from "./reducer.js";
import { layoutDag } from "./dag-layout.js";
import { ReporterError } from "./errors.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** Create an HTML renderer that writes a self-contained report on flush(). */
export function createHtmlRenderer(options: HtmlRendererOptions): Renderer {
  let state: UIState = createInitialState();
  let findings: readonly Finding[] = [];
  let verdict: PolicyResult | null = null;

  return {
    onEvent(event: RunEvent): void {
      state = reduceEvent(state, event);
    },

    onFindings(f: readonly Finding[]): void {
      findings = f;
    },

    onVerdict(result: PolicyResult): void {
      verdict = result;
    },

    flush(): void {
      const dagLayout = options.graph
        ? layoutDag(options.graph)
        : { nodes: [], edges: [] };
      const dagLayoutTB = options.graph
        ? layoutDag(options.graph, { direction: "TB" })
        : { nodes: [], edges: [] };

      const html = generateHtml(
        state,
        findings,
        verdict,
        dagLayout,
        dagLayoutTB,
        options.context,
      );

      try {
        mkdirSync(dirname(options.outputPath), { recursive: true });
        writeFileSync(options.outputPath, html, "utf-8");
      } catch (e) {
        throw new ReporterError(
          `Failed to write HTML report to ${options.outputPath}`,
          "RENDER_ERROR",
          e,
        );
      }
    },
  };
}

// --- HTML generation ---

const STATUS_ICONS: Record<string, string> = {
  pending: "◯",
  ready: "◇",
  running: "▶",
  succeeded: "✓",
  failed: "✗",
  skipped: "⊘",
  cancelled: "⊘",
  "cache-hit": "◒",
  suspended: "⏸",
  compensating: "↺",
  compensated: "↺",
};

const STATUS_COLORS: Record<string, string> = {
  succeeded: "#3fb950",
  failed: "#f85149",
  skipped: "#8b949e",
  cancelled: "#d29922",
  running: "#58a6ff",
  "cache-hit": "#56d4dd",
  pending: "#8b949e",
  ready: "#8b949e",
  suspended: "#d29922",
  compensating: "#d29922",
  compensated: "#3fb950",
};

const STATUS_COLOR_DEFAULT = "#8b949e";

type DagLayout = {
  nodes: readonly {
    id: string;
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
    layer: number;
  }[];
  edges: readonly {
    source: string;
    target: string;
    label?: string;
    points?: readonly { x: number; y: number }[];
  }[];
};

/** Common `ns/` prefix of step ids (e.g. all ids under "ci/").
 * Uses each id's FIRST segment, so nested ids like "ci/a/b" still
 * count as "ci/". Returns "" when ids don't share a namespace —
 * multi-pipeline runs keep their prefixes visible. */
function commonNsPrefix(ids: readonly string[]): string {
  if (ids.length === 0) return "";
  const cut = ids[0]!.indexOf("/");
  if (cut < 0) return "";
  const prefix = ids[0]!.slice(0, cut + 1);
  return ids.every((id) => id.startsWith(prefix)) ? prefix : "";
}

/** Strip the shared namespace prefix for display. */
function displayId(id: string, prefix: string): string {
  return prefix && id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

function statusColor(state?: string): string {
  return STATUS_COLORS[state ?? ""] ?? STATUS_COLOR_DEFAULT;
}

function fmtMs(ms?: number): string {
  if (ms === undefined || ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  return s < 60
    ? `${s.toFixed(1)}s`
    : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

/** Render the HTML head section. */
function renderHead(title: string): string {
  // nosemgrep: html-in-template-string
  return `<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${CSS}</style>
</head>`;
}

/** Render the context block: title + run facts + clickable links. */
function renderContext(state: UIState, context?: ReportContext): string {
  const title = context?.title ?? "Sverka Run Report";
  const status = state.status ?? "unknown";
  const duration = state.durationMs ?? 0;

  const metaRows = [
    ["Plan", state.planId ?? "unknown"],
    ["Status", status],
    ["Duration", fmtMs(duration)],
    ...(context?.command ? [["Command", context.command]] : []),
    ...(context?.meta ?? []).map((m) => [m.label, m.value] as const),
  ];
  const linkRows = (context?.links ?? [])
    .map((l) => {
      // Only http(s) links become anchors — other schemes (javascript:,
      // data:, ...) render as inert text.
      const safe = /^https?:\/\//i.test(l.url);
      const value = safe
        ? `<a class="ctx-link" href="${escapeHtml(l.url)}">${escapeHtml(l.url)}</a>` // nosemgrep: html-in-template-string
        : `<span class="ctx-value">${escapeHtml(l.url)}</span>`;
      return `<span class="ctx-label">${escapeHtml(l.label)}:</span> ${value}`; // nosemgrep: html-in-template-string
    })
    .join("\n      ");

  const generatedAt = context?.generatedAt
    ? `<span class="ctx-label">Generated:</span> <span class="ctx-value">${escapeHtml(context.generatedAt)}</span>`
    : "";

  // nosemgrep: html-in-template-string
  return `<header>
    <h1>${escapeHtml(title)}</h1>
    <div class="run-context">
      ${metaRows
        .map(
          ([label, value]) =>
            `<span class="ctx-label">${escapeHtml(label)}:</span> <span class="ctx-value status-${escapeHtml(String(value))}">${escapeHtml(String(value))}</span>`, // nosemgrep: html-in-template-string
        )
        .join("\n      ")}
      ${linkRows}
      ${generatedAt}
    </div>
  </header>`;
}

/** Steps sorted for display: by start time, then id. */
function orderedSteps(state: UIState): StepUIState[] {
  return [...state.steps.values()].sort(
    (a, b) =>
      (a.startedAt ?? a.finishedAt ?? Infinity) -
        (b.startedAt ?? b.finishedAt ?? Infinity) ||
      a.stepId.localeCompare(b.stepId),
  );
}

/** Static SVG Gantt — one bar per step positioned on the run timeline. */
function renderGanttSvg(state: UIState, nsPrefix: string): string {
  const steps = orderedSteps(state);
  const starts = steps
    .map((s) => s.startedAt)
    .filter((v): v is number => v !== undefined);
  const ends = steps
    .map((s) => s.finishedAt)
    .filter((v): v is number => v !== undefined);

  if (starts.length === 0 && ends.length === 0) {
    return '<p class="view-note">No timing data — events were not timestamped.</p>';
  }

  const t0 = state.startedAt ?? Math.min(...starts, ...ends);
  const t1 = Math.max(state.finishedAt ?? 0, Math.max(...ends, t0 + 1), t0 + 1);
  const span = Math.max(t1 - t0, 1);

  const rowH = 26;
  const labelW = 180;
  const barArea = 620;
  const pad = 28;
  const width = labelW + barArea + 60;
  const height = pad + steps.length * rowH + 8;

  const tickCount = 5;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => {
    const t = (span / tickCount) * i;
    const x = labelW + (t / span) * barArea;
    return `<line class="grid" x1="${x}" y1="${pad - 6}" x2="${x}" y2="${height}" /><text class="tick" x="${x}" y="${pad - 12}" text-anchor="middle">${fmtMs(t)}</text>`;
  }).join("");

  const rows = steps
    .map((s, i) => {
      const y = pad + i * rowH;
      const label = escapeHtml(displayId(s.stepId, nsPrefix));
      const color = statusColor(s.state);
      let bar: string;
      if (s.startedAt !== undefined) {
        const end = s.finishedAt ?? s.startedAt + (s.durationMs ?? 0);
        const x = labelW + ((s.startedAt - t0) / span) * barArea;
        const w = Math.max(((end - s.startedAt) / span) * barArea, 3);
        bar = `<rect class="bar" x="${x.toFixed(1)}" y="${y + 5}" width="${w.toFixed(1)}" height="16" rx="3" fill="${color}"><title>${escapeHtml(s.stepId)} — ${escapeHtml(s.state)} — ${fmtMs(s.durationMs)}</title></rect><text class="dur" x="${(x + w + 6).toFixed(1)}" y="${y + 18}">${fmtMs(s.durationMs)}</text>`;
      } else {
        bar = `<text class="dur notime" x="${labelW + 4}" y="${y + 18}">${escapeHtml(s.state)}</text>`;
      }
      // nosemgrep: html-in-template-string
      return `<g class="gantt-step" data-step="${escapeHtml(s.stepId)}"><text class="row-label" x="4" y="${y + 18}">${label}</text>${bar}</g>`;
    })
    .join("");

  // nosemgrep: html-in-template-string
  return `<svg class="gantt" viewBox="0 0 ${width} ${height}" role="img" aria-label="Step timeline">${ticks}${rows}</svg>`;
}

/** Edge + node markup for one laid-out direction of the DAG. */
function renderDagLayer(
  state: UIState,
  dag: DagLayout,
  nsPrefix: string,
): { markup: string; vb: string } {
  const maxX = Math.max(...dag.nodes.map((n) => n.x + n.width)) + 16;
  const maxY = Math.max(...dag.nodes.map((n) => n.y + n.height)) + 16;

  // Dagre collapses parallel edges between the same pair — render one
  // path per pair, joining the dependency kinds in the label.
  const pairs = new Map<string, string[]>();
  for (const e of dag.edges) {
    const key = `${e.source}${e.target}`;
    const kinds = pairs.get(key) ?? [];
    if (e.label && !kinds.includes(e.label)) kinds.push(e.label);
    pairs.set(key, kinds);
  }

  const edges = dag.edges
    .filter(
      (e, i) =>
        dag.edges.findIndex(
          (o) => o.source === e.source && o.target === e.target,
        ) === i,
    )
    .map((e) => {
      const pts = e.points;
      if (!pts || pts.length < 2) return "";
      // Smooth the polyline: quadratic curves through each routing
      // vertex, landing at midpoints — the ReactFlow "smoothstep" look.
      let d = `M ${pts[0]!.x} ${pts[0]!.y}`;
      for (let i = 1; i < pts.length - 1; i++) {
        const p = pts[i]!;
        const next = pts[i + 1]!;
        d += ` Q ${p.x} ${p.y} ${(p.x + next.x) / 2} ${(p.y + next.y) / 2}`;
      }
      const last = pts[pts.length - 1]!;
      d += ` L ${last.x} ${last.y}`;
      const kinds = pairs.get(`${e.source}${e.target}`) ?? [];
      const mid = pts[Math.floor(pts.length / 2)]!;
      const label = kinds.length
        ? `<text class="edge-label" x="${mid.x}" y="${mid.y - 5}" text-anchor="middle">${escapeHtml(kinds.join("+"))}</text>` // nosemgrep: html-in-template-string
        : "";
      // nosemgrep: html-in-template-string
      return `<path class="edge" data-src="${escapeHtml(e.source)}" data-dst="${escapeHtml(e.target)}" d="${d}" marker-end="url(#arrow)" />${label}`;
    })
    .join("");

  const nodes = dag.nodes
    .map((n) => {
      const step = state.steps.get(n.id);
      const color = statusColor(step?.state);
      const short = displayId(n.id, nsPrefix);
      const label = short.length > 24 ? `${short.slice(0, 23)}…` : short;
      const cy = n.y + n.height / 2;
      // nosemgrep: html-in-template-string
      return `<g class="dag-node" data-step="${escapeHtml(n.id)}">
        <title>${escapeHtml(n.id)}</title>
        <rect class="dag-card" x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="8" />
        <circle cx="${n.x + 16}" cy="${cy}" r="4" fill="${color}" />
        <text x="${n.x + 28}" y="${cy - 2}">${escapeHtml(label)}</text>
        <text class="node-status" x="${n.x + 28}" y="${cy + 12}" style="fill:${color}">${escapeHtml(step?.state ?? "pending")}</text>
      </g>`;
    })
    .join("");

  // Padding around the graph inside the viewBox — keeps nodes off the
  // viewport edge. Zoom/pan manipulate the viewBox (uniform scale keeps
  // the aspect constant, so the svg height never jumps).
  const pad = 40;
  return {
    markup: edges + nodes,
    vb: `${-pad} ${-pad} ${maxX + pad * 2} ${maxY + pad * 2}`,
  };
}

/** Static SVG DAG — dagre-routed layout, nodes colored by step status.
 *  Both LR and TB layouts are rendered; a toolbar button toggles them. */
function renderDagSvg(
  state: UIState,
  dag: DagLayout,
  dagTB: DagLayout,
  nsPrefix: string,
): string {
  if (dag.nodes.length === 0) {
    return '<p class="view-note">No graph data.</p>';
  }

  const lr = renderDagLayer(state, dag, nsPrefix);
  const tb = renderDagLayer(state, dagTB, nsPrefix);
  const lrGrid = `<rect class="dag-grid" x="-40" y="-40" width="100000" height="100000" fill="url(#dag-dots)" />`;
  const mini = (
    layer: { markup: string; vb: string },
    dir: string,
    hidden: boolean,
  ) =>
    `<svg class="dag-mini" viewBox="${layer.vb}" data-dir="${dir}"${hidden ? " hidden" : ""}>${layer.markup}</svg>`;

  // nosemgrep: html-in-template-string
  return `<div class="dag-viewport">
    <div class="dag-tools">
      <button type="button" class="dag-btn" data-dag-zoom="in" title="Zoom in">+</button>
      <button type="button" class="dag-btn" data-dag-zoom="out" title="Zoom out">−</button>
      <button type="button" class="dag-btn" data-dag-zoom="fit" title="Fit to viewport">fit</button>
      <button type="button" class="dag-btn" data-dag-dir title="Switch direction (LR/TB)">⇄</button>
    </div>
    <svg id="dag-svg" class="dag" viewBox="${lr.vb}" data-vb-lr="${lr.vb}" data-vb-tb="${tb.vb}" role="img" aria-label="Workflow DAG">
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" /></marker>
      <pattern id="dag-dots" width="24" height="24" patternUnits="userSpaceOnUse" x="-40" y="-40"><circle cx="1" cy="1" r="1" /></pattern>
    </defs>
    <g class="dag-dir" data-dir="LR">${lrGrid}${lr.markup}</g>
    <g class="dag-dir" data-dir="TB" hidden>${lrGrid}${tb.markup}</g>
    </svg>
    <div class="dag-minimap" id="dag-minimap">
      ${mini(lr, "LR", false)}${mini(tb, "TB", true)}
      <div class="dag-mini-vp" id="dag-mini-vp"></div>
    </div>
  </div>`;
}

/** List view — per-step expandable row with output tails. */
function renderStepList(state: UIState, nsPrefix: string): string {
  if (state.steps.size === 0) {
    return "<p>No steps recorded.</p>";
  }

  return orderedSteps(state)
    .map((step) => {
      const icon = STATUS_ICONS[step.state] ?? "◯";
      const bodyParts: string[] = [];
      if (step.error) {
        bodyParts.push(
          `<div class="step-error">${escapeHtml(step.error)}</div>`,
        ); // nosemgrep: html-in-template-string
      }
      if (step.attempt != null) {
        bodyParts.push(
          `<div class="step-attempt">Attempt: ${step.attempt}</div>`,
        ); // nosemgrep: html-in-template-string
      }
      if (step.exitCode !== undefined) {
        bodyParts.push(
          `<div class="step-exit">Exit code: ${step.exitCode}</div>`,
        ); // nosemgrep: html-in-template-string
      }
      if (step.stdout) {
        bodyParts.push(
          `<pre class="step-out">${escapeHtml(step.stdout)}</pre>`,
        ); // nosemgrep: html-in-template-string
      }
      if (step.stderr) {
        bodyParts.push(
          `<pre class="step-out err">${escapeHtml(step.stderr)}</pre>`,
        ); // nosemgrep: html-in-template-string
      }

      // nosemgrep: html-in-template-string
      return `      <details>
        <summary><span class="step-icon">${icon}</span> ${escapeHtml(displayId(step.stepId, nsPrefix))} <span class="step-state ${step.state}">${step.state}</span> <span class="meta">${fmtMs(step.durationMs)}</span> <button type="button" class="step-findings" data-step="${escapeHtml(step.stepId)}" title="Show only findings from this step">findings</button></summary>
        <div class="step-body">${bodyParts.join("") || '<span class="meta">no output captured</span>'}</div>
      </details>`;
    })
    .join("\n");
}

/** Dependency tree — nested lists built from DAG edges. */
function renderTree(state: UIState, dag: DagLayout, nsPrefix: string): string {
  if (dag.nodes.length === 0) {
    return '<p class="view-note">No graph data.</p>';
  }
  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const e of dag.edges) {
    children.set(e.source, [...(children.get(e.source) ?? []), e.target]);
    hasParent.add(e.target);
  }
  const ids = new Set(dag.nodes.map((n) => n.id));
  const roots = dag.nodes.filter((n) => !hasParent.has(n.id)).map((n) => n.id);

  const item = (id: string): string => {
    const step = state.steps.get(id);
    const icon = STATUS_ICONS[step?.state ?? "pending"] ?? "◯";
    const color = statusColor(step?.state);
    const kids = (children.get(id) ?? []).filter((k) => ids.has(k));
    const nested = kids.length ? `<ul>${kids.map(item).join("")}</ul>` : "";
    // nosemgrep: html-in-template-string
    return `<li><span class="tree-node" data-step="${escapeHtml(id)}" style="border-color:${color}">${icon} ${escapeHtml(displayId(id, nsPrefix))} <span class="meta">${escapeHtml(step?.state ?? "pending")}</span></span>${nested}</li>`;
  };

  // nosemgrep: html-in-template-string
  return `<ul class="tree">${roots.map(item).join("")}</ul>`;
}

/** Render the steps panel with the Gantt | DAG | Tree | List view switch. */
function renderStepsSection(
  state: UIState,
  dag: DagLayout,
  dagTB: DagLayout,
): string {
  // Shared `ns/` prefix (e.g. "ci/") is stripped from labels — it is
  // noise in a single-pipeline report. Full ids stay in tooltips.
  const nsPrefix = commonNsPrefix([
    ...dag.nodes.map((n) => n.id),
    ...state.steps.keys(),
  ]);
  // nosemgrep: html-in-template-string
  return `<section id="steps">
    <div class="section-head">
      <h2>Steps</h2>
      <div class="segmented" id="view-switch">
        <button class="seg-btn active" data-view="gantt">Gantt</button>
        <button class="seg-btn" data-view="dag">DAG</button>
        <button class="seg-btn" data-view="tree">Tree</button>
        <button class="seg-btn" data-view="list">List</button>
      </div>
    </div>
    <div class="view" id="view-gantt">${renderGanttSvg(state, nsPrefix)}</div>
    <div class="view hidden" id="view-dag">${renderDagSvg(state, dag, dagTB, nsPrefix)}</div>
    <div class="view hidden" id="view-tree">${renderTree(state, dag, nsPrefix)}</div>
    <div class="view hidden" id="view-list">${renderStepList(state, nsPrefix)}</div>
  </section>`;
}

/** Render the findings section with filter controls and table. */
function renderFindingsSection(findingsHtml: string): string {
  // nosemgrep: html-in-template-string
  return `<section id="findings">
    <h2>Findings</h2>
    <div class="findings-controls">
      <span id="step-filter-chip" class="step-filter-chip hidden">
        step: <b id="step-filter-name"></b>
        <button type="button" id="step-filter-clear" title="Clear step filter">×</button>
      </span>
      <div class="filter-buttons">
        <button class="filter-btn active" data-severity="all">All</button>
        <button class="filter-btn" data-severity="critical">Critical</button>
        <button class="filter-btn" data-severity="high">High</button>
        <button class="filter-btn" data-severity="medium">Medium</button>
        <button class="filter-btn" data-severity="low">Low</button>
        <button class="filter-btn" data-severity="info">Info</button>
      </div>
      <input type="text" id="findings-search" placeholder="Search findings..." class="search-input">
    </div>
    <table id="findings-table">
      <thead>
        <tr>
          <th data-sort="severity" class="sortable">Severity</th>
          <th data-sort="checkId" class="sortable">Check</th>
          <th data-sort="file" class="sortable">File</th>
          <th data-sort="startLine" class="sortable">Line</th>
          <th data-sort="message" class="sortable">Message</th>
        </tr>
      </thead>
      <tbody>
        ${findingsHtml}
      </tbody>
    </table>
  </section>`;
}

/** Render the inline script: view switch, layout toggle, findings filter. */
function renderScripts(findingsData: string): string {
  // nosemgrep: html-in-template-string
  return `<script>
    var __FINDINGS_DATA__ = ${findingsData};
  </script>
  <script>${JS}</script>`;
}

function generateHtml(
  state: UIState,
  findings: readonly Finding[],
  verdict: PolicyResult | null,
  dagLayout: DagLayout,
  dagLayoutTB: DagLayout,
  context?: ReportContext,
): string {
  const findingsHtml = renderFindings(findings);
  const verdictHtml = renderVerdict(verdict);
  const findingsData = escapeScriptData(
    JSON.stringify(
      findings.map((f) => ({
        severity: f.severity,
        checkId: f.checkId,
        file: f.file,
        startLine: f.startLine,
        endLine: f.endLine,
        message: f.message,
        rule: f.rule,
      })),
    ),
  );

  return `<!DOCTYPE html>
<html lang="en">
${renderHead(context?.title ?? "Sverka Run Report")}
<body>
  ${renderContext(state, context)}

  ${verdictHtml}

  <div class="layout-toggle">
    <div class="segmented" id="layout-switch">
      <button class="seg-btn active" data-layout="stacked">Stacked</button>
      <button class="seg-btn" data-layout="split">Split</button>
    </div>
  </div>

  <main id="layout" class="stacked">
    ${renderStepsSection(state, dagLayout, dagLayoutTB)}

    ${renderFindingsSection(findingsHtml)}
  </main>

  ${renderScripts(findingsData)}
</body>
</html>`;
}

function renderFindings(findings: readonly Finding[]): string {
  if (findings.length === 0) {
    return '<tr><td colspan="5" class="no-findings">No findings</td></tr>';
  }

  // nosemgrep: html-in-template-string
  return findings
    .map(
      (f) => `        <tr data-severity="${escapeHtml(f.severity)}">
          <td class="severity-${escapeHtml(f.severity)}">${escapeHtml(f.severity)}</td>
          <td>${escapeHtml(f.checkId)}</td>
          <td>${escapeHtml(f.file)}</td>
          <td>${f.startLine}</td>
          <td>${escapeHtml(f.message)}</td>
        </tr>`,
    )
    .join("\n");
}

function renderVerdict(verdict: PolicyResult | null): string {
  if (!verdict) {
    return '<section id="verdict"><div class="verdict-banner verdict-none">No policy evaluation</div></section>';
  }

  const cls = verdict.verdict === "pass" ? "verdict-pass" : "verdict-fail";
  // nosemgrep: html-in-template-string
  return `<section id="verdict">
    <div class="verdict-banner ${cls}">
      Policy: ${escapeHtml(verdict.verdict.toUpperCase())} &mdash; ${escapeHtml(verdict.summary)}
    </div>
  </section>`;
}

function escapeHtml(text: string): string {
  return text // nosemgrep
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Escape JSON data for safe embedding in <script> tags.
 * Prevents </script> breakout XSS by replacing < with <. */
function escapeScriptData(json: string): string {
  return json.replaceAll("<", "\\u003c"); // nosemgrep
}

const CSS = String.raw`
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 0;
  background: #0d1117;
  color: #c9d1d9;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  line-height: 1.6;
}
header {
  padding: 1rem 2rem;
  background: #161b22;
  border-bottom: 1px solid #30363d;
}
header h1 { margin: 0 0 0.5rem 0; font-size: 1.5rem; color: #f0f6fc; }
.run-context { font-size: 0.875rem; color: #8b949e; }
.ctx-label { font-weight: 600; margin-right: 0.25rem; }
.ctx-value { margin-right: 1rem; }
.ctx-link { margin-right: 1rem; color: #58a6ff; word-break: break-all; }
.status-success { color: #3fb950; }
.status-succeeded { color: #3fb950; }
.status-failure { color: #f85149; }
.status-failed { color: #f85149; }
.status-cancelled { color: #d29922; }
section { padding: 1rem 2rem; border-bottom: 1px solid #21262d; }
section h2 { font-size: 1.25rem; color: #f0f6fc; margin: 0 0 1rem 0; }
.section-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 1rem; }
.section-head h2 { margin: 0; }
.layout-toggle { padding: 0.5rem 2rem; display: flex; justify-content: flex-end; }
main.stacked { display: block; }
main.split { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); align-items: start; }
main.split section { border-bottom: none; }
main.split section + section { border-left: 1px solid #21262d; }
.segmented {
  display: inline-flex;
  border: 1px solid #30363d;
  border-radius: 6px;
  overflow: hidden;
}
.seg-btn {
  padding: 0.25rem 0.75rem;
  border: none;
  border-right: 1px solid #30363d;
  background: #21262d;
  color: #c9d1d9;
  cursor: pointer;
  font-size: 0.8rem;
}
.seg-btn:last-child { border-right: none; }
.seg-btn.active { background: #1f6feb; color: #fff; }
.seg-btn:hover { background: #30363d; }
.seg-btn.active:hover { background: #1f6feb; }
.view.hidden { display: none; }
.view-note { color: #8b949e; font-size: 0.875rem; }
svg.gantt { width: 100%; height: auto; background: #161b22; border: 1px solid #30363d; border-radius: 6px; }
svg.gantt .grid { stroke: #21262d; stroke-width: 1; }
svg.gantt .tick { fill: #8b949e; font-size: 10px; }
svg.gantt .row-label { fill: #c9d1d9; font-size: 11px; font-family: ui-monospace, SFMono-Regular, monospace; }
svg.gantt .dur { fill: #8b949e; font-size: 10px; }
svg.gantt .dur.notime { font-style: italic; }
svg.dag { width: 100%; height: auto; background: #0d1117; }
svg.dag .dag-grid { pointer-events: none; }
svg.dag #dag-dots circle { fill: #21262d; }
svg.dag .dag-card { fill: #161b22; stroke: #30363d; stroke-width: 1.5; }
svg.dag .dag-node text { fill: #e6edf3; font-size: 11px; font-family: ui-monospace, SFMono-Regular, monospace; }
svg.dag .dag-node .node-status { font-size: 9px; text-transform: uppercase; }
svg.dag .edge { stroke: #4a5568; stroke-width: 1.5; fill: none; }
svg.dag .edge-label { fill: #8b949e; font-size: 9px; paint-order: stroke; stroke: #0d1117; stroke-width: 3; }
svg.dag marker path { fill: #4a5568; }
.verdict-banner {
  padding: 0.75rem 1rem;
  border-radius: 6px;
  font-weight: 600;
  font-size: 1rem;
  margin: 1rem 2rem 0;
}
#verdict { padding: 0; border-bottom: none; }
.verdict-pass { background: #1a3a2e; color: #3fb950; border: 1px solid #2ea043; }
.verdict-fail { background: #3a1a1a; color: #f85149; border: 1px solid #da3633; }
.verdict-none { background: #21262d; color: #8b949e; }
.findings-controls { display: flex; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap; align-items: center; }
.filter-buttons { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.filter-btn {
  padding: 0.25rem 0.75rem;
  border: 1px solid #30363d;
  border-radius: 6px;
  background: #21262d;
  color: #c9d1d9;
  cursor: pointer;
  font-size: 0.8rem;
}
.filter-btn.active { background: #1f6feb; border-color: #1f6feb; color: #fff; }
.filter-btn:hover { border-color: #8b949e; }
.search-input {
  padding: 0.25rem 0.5rem;
  border: 1px solid #30363d;
  border-radius: 6px;
  background: #0d1117;
  color: #c9d1d9;
  font-size: 0.8rem;
  flex: 1;
  min-width: 200px;
}
table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #21262d; }
th { color: #8b949e; font-weight: 600; cursor: pointer; user-select: none; }
th.sortable:hover { color: #f0f6fc; }
th.sort-asc::after { content: " \2191"; }
th.sort-desc::after { content: " \2193"; }
.severity-critical { color: #f85149; font-weight: 600; }
.severity-high { color: #f85149; }
.severity-medium { color: #d29922; }
.severity-low { color: #8b949e; }
.severity-info { color: #58a6ff; }
.no-findings { text-align: center; color: #8b949e; padding: 2rem; }
details { margin-bottom: 0.5rem; border: 1px solid #21262d; border-radius: 6px; padding: 0.5rem; }
details summary { cursor: pointer; font-size: 0.875rem; }
.step-icon { font-size: 1rem; }
.step-state { font-size: 0.75rem; padding: 0.1rem 0.4rem; border-radius: 4px; margin-left: 0.5rem; }
.step-state.succeeded { color: #3fb950; }
.step-state.failed { color: #f85149; }
.step-state.skipped { color: #8b949e; }
.step-state.cancelled { color: #d29922; }
.step-state.running { color: #58a6ff; }
.step-body { margin-top: 0.5rem; padding-left: 1rem; font-size: 0.8rem; color: #8b949e; }
.step-error { color: #f85149; }
.step-attempt { color: #d29922; }
.step-out {
  font-size: 0.75rem;
  max-height: 16rem;
  overflow: auto;
  background: #0d1117;
  border: 1px solid #21262d;
  border-radius: 6px;
  padding: 0.5rem;
  white-space: pre-wrap;
  word-break: break-all;
}
.step-out.err { color: #f85149; }
ul.tree, ul.tree ul { list-style: none; padding-left: 1.25rem; }
ul.tree { padding-left: 0; }
ul.tree li { margin: 0.35rem 0; }
ul.tree li li { border-left: 1px solid #30363d; padding-left: 0.75rem; }
.tree-node {
  display: inline-block;
  padding: 0.15rem 0.6rem;
  border: 1px solid #30363d;
  border-left-width: 3px;
  border-radius: 4px;
  background: #161b22;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.8rem;
}
.step-active .dag-card { stroke: #58a6ff; stroke-width: 2.5; }
.step-active.tree-node { outline: 2px solid #58a6ff; outline-offset: 1px; }
.step-active > .bar { stroke: #58a6ff; stroke-width: 2; }
/* Hover focus: connected edges + neighbor nodes stay lit, the rest dims */
svg.dag.focus .edge { opacity: .25; }
svg.dag.focus .edge.edge-hot { opacity: 1; stroke: #58a6ff; stroke-width: 2; }
svg.dag.focus .edge.edge-hot + .edge-label { opacity: 1; fill: #79c0ff; }
svg.dag.focus .edge-label { opacity: .25; }
svg.dag.focus .dag-node { opacity: .35; transition: opacity .12s; }
svg.dag.focus .dag-node.node-lit { opacity: 1; }
.dag-dir[hidden], svg.dag-mini[hidden] { display: none; }
.dag-minimap {
  position: absolute;
  right: 12px;
  bottom: 12px;
  width: 168px;
  height: 104px;
  border: 1px solid #30363d;
  border-radius: 6px;
  background: rgba(13, 17, 23, .92);
  overflow: hidden;
}
.dag-minimap svg.dag-mini { width: 100%; height: 100%; display: block; }
.dag-minimap svg.dag-mini .edge,
.dag-minimap svg.dag-mini .edge-label,
.dag-minimap svg.dag-mini text { display: none; }
.dag-minimap svg.dag-mini .dag-card { stroke-width: 4; }
.dag-minimap .dag-mini-vp {
  position: absolute;
  border: 1.5px solid #58a6ff;
  background: rgba(88, 166, 255, .12);
  border-radius: 2px;
  cursor: grab;
}
.dag-viewport {
  position: relative;
  border: 1px solid #21262d;
  border-radius: 8px;
  background: #0d1117;
  overflow: hidden;
}
.dag-viewport svg.dag {
  display: block;
  width: 100%;
  /* Fixed height box — the svg centers its viewBox inside
     (preserveAspectRatio=meet), keeping the minimap on screen for
     tall TB layouts. */
  height: min(600px, 72vh);
  cursor: grab;
  touch-action: none;
}
.dag-viewport svg.dag.panning { cursor: grabbing; }
.dag-tools {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  display: flex;
  gap: 0.25rem;
  z-index: 2;
}
.dag-btn {
  padding: 0.1rem 0.5rem;
  border: 1px solid #30363d;
  border-radius: 4px;
  background: rgba(33, 38, 45, 0.9);
  color: #e6edf3;
  font-size: 0.8rem;
  cursor: pointer;
}
.dag-btn:hover { border-color: #58a6ff; color: #58a6ff; }
.dag-node { cursor: pointer; }
.gantt-step, .tree-node { cursor: pointer; }
.gantt-step:hover .row-label { fill: #58a6ff; }
.dag-node:hover .dag-card { stroke: #58a6ff; }
.step-findings {
  margin-left: 0.5rem;
  padding: 0 0.4rem;
  font-size: 0.7rem;
  border: 1px solid #30363d;
  border-radius: 4px;
  background: #21262d;
  color: #8b949e;
  cursor: pointer;
}
.step-findings:hover { color: #58a6ff; border-color: #58a6ff; }
.step-filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.15rem 0.6rem;
  border: 1px solid #1f6feb;
  border-radius: 12px;
  background: rgba(31, 111, 235, 0.15);
  color: #58a6ff;
  font-size: 0.8rem;
}
.step-filter-chip.hidden { display: none; }
.step-filter-chip button {
  border: none;
  background: none;
  color: inherit;
  cursor: pointer;
  font-size: 0.95rem;
  padding: 0 0.1rem;
}
.meta { color: #8b949e; }
@media (max-width: 900px) {
  main.split { grid-template-columns: 1fr; }
  main.split section + section { border-left: none; border-top: 1px solid #21262d; }
}
@media (max-width: 768px) {
  section { padding: 1rem; }
  .findings-controls { flex-direction: column; }
  .search-input { min-width: 100%; }
  table { font-size: 0.75rem; }
  th, td { padding: 0.3rem 0.5rem; }
}
`;

/* nosemgrep */ const JS = `
(function() {
  function esc(text) {
    var d = document.createElement("div");
    d.textContent = text == null ? "" : String(text);
    return d.innerHTML;
  }

  // View switch (gantt | dag | list)
  document.querySelectorAll("#view-switch .seg-btn").forEach(function(btn) {
    btn.addEventListener("click", function() {
      document.querySelectorAll("#view-switch .seg-btn").forEach(function(b) { b.classList.remove("active"); });
      btn.classList.add("active");
      var view = btn.getAttribute("data-view");
      document.querySelectorAll("#steps .view").forEach(function(el) {
        el.classList.toggle("hidden", el.id !== "view-" + view);
      });
      // Minimap geometry was measured while the DAG view was hidden —
      // recompute the indicator with real dimensions on activation.
      if (view === "dag" && window.__dagUpdateMini) window.__dagUpdateMini();
    });
  });

  // Layout toggle (stacked | split)
  document.querySelectorAll("#layout-switch .seg-btn").forEach(function(btn) {
    btn.addEventListener("click", function() {
      document.querySelectorAll("#layout-switch .seg-btn").forEach(function(b) { b.classList.remove("active"); });
      btn.classList.add("active");
      var layout = document.getElementById("layout");
      if (layout) layout.className = btn.getAttribute("data-layout");
    });
  });

  // Findings filter/sort/search
  var findingsData = window.__FINDINGS_DATA__ || [];
  var currentFilter = "all";
  var currentSearch = "";
  var stepFilter = null;
  var sortColumn = null;
  var sortDir = 1;

  // Findings checkIds are rule-qualified (e.g. ci/lint:rule-id); a
  // step filter must match the bare step id too — mirrors the policy
  // evaluator's matchesCheckId semantics.
  function stepMatches(stepId, checkId) {
    var bareStep = stepId.indexOf("checks/") === 0 ? stepId.slice(7) : stepId;
    var bareCheck = checkId.indexOf("checks/") === 0 ? checkId.slice(7) : checkId;
    return bareCheck === bareStep || bareCheck.indexOf(bareStep + ":") === 0;
  }

  function renderTable() {
    var tbody = document.querySelector("#findings-table tbody");
    if (!tbody) return;
    var filtered = findingsData.filter(function(f) {
      if (stepFilter && !stepMatches(stepFilter, f.checkId)) return false;
      if (currentFilter !== "all" && f.severity !== currentFilter) return false;
      if (currentSearch) {
        var search = currentSearch.toLowerCase();
        return (f.severity + " " + f.checkId + " " + f.file + " " + f.startLine + " " + f.message).toLowerCase().indexOf(search) !== -1;
      }
      return true;
    });
    if (sortColumn) {
      filtered.sort(function(a, b) {
        var va = a[sortColumn], vb = b[sortColumn];
        if (typeof va === "number" && typeof vb === "number") return (va - vb) * sortDir;
        return String(va).localeCompare(String(vb)) * sortDir;
      });
    }
    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="no-findings">No findings</td></tr>';
      return;
    }
    tbody.innerHTML = filtered.map(function(f) {
      return '<tr data-severity="' + esc(f.severity) + '">' +
        '<td class="severity-' + esc(f.severity) + '">' + esc(f.severity) + '</td>' +
        '<td>' + esc(f.checkId) + '</td>' +
        '<td>' + esc(f.file) + '</td>' +
        '<td>' + esc(f.startLine) + '</td>' +
        '<td>' + esc(f.message) + '</td>' +
        '</tr>';
    }).join("");
  }

  // DAG zoom/pan — the viewBox is manipulated directly. Zoom is
  // uniform (w and h scale together) so the svg aspect never changes
  // and the element height stays stable.
  (function() {
    var svg = document.getElementById("dag-svg");
    if (!svg) return;
    var bases = {
      LR: (svg.getAttribute("data-vb-lr") || "0 0 100 100").split(" ").map(Number),
      TB: (svg.getAttribute("data-vb-tb") || "0 0 100 100").split(" ").map(Number),
    };
    var dir = "LR";
    var base = bases[dir];
    var vb = { x: base[0], y: base[1], w: base[2], h: base[3] };
    var savedVb = { LR: null, TB: null };
    var baseW = base[2];
    var moved = 0;
    var captured = false;
    var miniVp = document.getElementById("dag-mini-vp");
    var minimap = document.getElementById("dag-minimap");

    // The mini svgs preserve aspect ratio (meet), so the graph may be
    // padded inside the minimap — map through the rendered box,
    // not the element rect.
    function miniBox() {
      var r = minimap.getBoundingClientRect();
      var s = Math.min(r.width / base[2], r.height / base[3]);
      return {
        r: r,
        s: s,
        ox: (r.width - base[2] * s) / 2,
        oy: (r.height - base[3] * s) / 2,
      };
    }
    function updateMini() {
      if (!miniVp || !minimap) return;
      var m = miniBox();
      miniVp.style.left = m.ox + (vb.x - base[0]) * m.s + "px";
      miniVp.style.top = m.oy + (vb.y - base[1]) * m.s + "px";
      miniVp.style.width = Math.min(vb.w, base[2]) * m.s + "px";
      miniVp.style.height = Math.min(vb.h, base[3]) * m.s + "px";
    }
    function apply() {
      svg.setAttribute("viewBox", vb.x + " " + vb.y + " " + vb.w + " " + vb.h);
      updateMini();
    }
    function zoomAt(factor, cx, cy) {
      var w = Math.min(Math.max(vb.w * factor, baseW / 8), baseW * 2);
      var f = w / vb.w;
      vb.x = cx - (cx - vb.x) * f;
      vb.y = cy - (cy - vb.y) * f;
      vb.w = w;
      vb.h = vb.h * f;
      apply();
    }
    // The svg element is a fixed-height box while the viewBox keeps the
    // graph's aspect — preserveAspectRatio=meet centers it, so map
    // pointer coordinates through the rendered box, not the element.
    function renderBox() {
      var r = svg.getBoundingClientRect();
      var s = Math.min(r.width / vb.w, r.height / vb.h);
      return {
        s: s,
        ox: r.left + (r.width - vb.w * s) / 2,
        oy: r.top + (r.height - vb.h * s) / 2,
      };
    }
    function toVb(e) {
      var m = renderBox();
      return {
        x: vb.x + (e.clientX - m.ox) / m.s,
        y: vb.y + (e.clientY - m.oy) / m.s,
      };
    }

    svg.addEventListener("wheel", function(e) {
      e.preventDefault();
      var p = toVb(e);
      zoomAt(e.deltaY > 0 ? 1.2 : 1 / 1.2, p.x, p.y);
    }, { passive: false });

    var drag = null;
    svg.addEventListener("pointerdown", function(e) {
      drag = { x: e.clientX, y: e.clientY };
      moved = 0;
      captured = false;
      svg.classList.add("panning");
    });
    svg.addEventListener("pointermove", function(e) {
      if (!drag) return;
      var scale = 1 / renderBox().s;
      moved += Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y);
      // Capture the pointer only once the drag threshold is passed —
      // capturing on pointerdown would retarget the click to the svg
      // and swallow node clicks.
      if (!captured && moved > 4) {
        try {
          svg.setPointerCapture(e.pointerId);
        } catch {}
        captured = true;
      }
      vb.x -= (e.clientX - drag.x) * scale;
      vb.y -= (e.clientY - drag.y) * scale;
      drag = { x: e.clientX, y: e.clientY };
      apply();
    });
    function endDrag() {
      drag = null;
      svg.classList.remove("panning");
    }
    svg.addEventListener("pointerup", endDrag);
    svg.addEventListener("pointercancel", endDrag);

    document.querySelectorAll("[data-dag-zoom]").forEach(function(btn) {
      btn.addEventListener("click", function(e) {
        e.stopPropagation();
        var mode = btn.getAttribute("data-dag-zoom");
        if (mode === "fit") {
          vb = { x: base[0], y: base[1], w: base[2], h: base[3] };
          apply();
        } else {
          zoomAt(mode === "in" ? 0.8 : 1.25, vb.x + vb.w / 2, vb.y + vb.h / 2);
        }
      });
    });

    // Direction toggle — swaps the pre-laid-out LR/TB groups and
    // resets the view to that layout's bounds.
    var dirBtn = svg.parentElement.querySelector("[data-dag-dir]");
    if (dirBtn) {
      dirBtn.addEventListener("click", function(e) {
        e.stopPropagation();
        savedVb[dir] = { x: vb.x, y: vb.y, w: vb.w, h: vb.h };
        dir = dir === "LR" ? "TB" : "LR";
        base = bases[dir];
        baseW = base[2];
        vb = savedVb[dir] || { x: base[0], y: base[1], w: base[2], h: base[3] };
        svg.querySelectorAll(".dag-dir").forEach(function(g) {
          g.toggleAttribute("hidden", g.getAttribute("data-dir") !== dir);
        });
        if (minimap) {
          minimap.querySelectorAll("svg.dag-mini").forEach(function(m) {
            m.toggleAttribute("hidden", m.getAttribute("data-dir") !== dir);
          });
        }
        apply();
        // The new layer has no highlight classes yet — relight the
        // node that owns the active step filter.
        if (window.__stepFilter) lightDag(window.__stepFilter);
        else clearDagLight();
      });
    }

    // Minimap — click/drag the viewport rect to pan the main view.
    if (minimap) {
      var miniDrag = false;
      function miniTo(e) {
        var m = miniBox();
        vb.x = base[0] + (e.clientX - m.r.left - m.ox) / m.s - vb.w / 2;
        vb.y = base[1] + (e.clientY - m.r.top - m.oy) / m.s - vb.h / 2;
        apply();
      }
      minimap.addEventListener("pointerdown", function(e) {
        e.stopPropagation();
        miniDrag = true;
        minimap.setPointerCapture(e.pointerId);
        miniTo(e);
      });
      minimap.addEventListener("pointermove", function(e) {
        if (miniDrag) miniTo(e);
      });
      function endMiniDrag() { miniDrag = false; }
      minimap.addEventListener("pointerup", endMiniDrag);
      minimap.addEventListener("pointercancel", endMiniDrag);
      minimap.addEventListener("click", function(e) { e.stopPropagation(); });
      updateMini();
    }

    // Hover focus — light the hovered node's edges and neighbors.
    function lightDag(id) {
      var lit = {};
      lit[id] = true;
      svg.querySelectorAll('.dag-dir:not([hidden]) .edge').forEach(function(p) {
        var hot = p.getAttribute("data-src") === id ||
                  p.getAttribute("data-dst") === id;
        p.classList.toggle("edge-hot", hot);
        if (hot) {
          lit[p.getAttribute("data-src")] = true;
          lit[p.getAttribute("data-dst")] = true;
        }
      });
      svg.querySelectorAll('.dag-dir:not([hidden]) .dag-node').forEach(function(n) {
        n.classList.toggle("node-lit", !!lit[n.getAttribute("data-step")]);
      });
      svg.classList.add("focus");
    }
    function clearDagLight() {
      svg.classList.remove("focus");
      svg.querySelectorAll(".edge-hot").forEach(function(p) {
        p.classList.remove("edge-hot");
      });
      svg.querySelectorAll(".node-lit").forEach(function(n) {
        n.classList.remove("node-lit");
      });
    }
    svg.addEventListener("mouseover", function(e) {
      var node = e.target.closest && e.target.closest(".dag-node");
      if (node) lightDag(node.getAttribute("data-step"));
    });
    svg.addEventListener("mouseout", function(e) {
      var node = e.target.closest && e.target.closest(".dag-node");
      var to = e.relatedTarget;
      if (node && !(to && to.closest && to.closest(".dag-node") === node)) {
        if (window.__stepFilter) lightDag(window.__stepFilter);
        else clearDagLight();
      }
    });
    // Called by the step-filter to keep a selected node's edges lit.
    window.__dagFocusId = function(id) { if (id) lightDag(id); else clearDagLight(); };
    window.__dagUpdateMini = updateMini;

    // A drag that ends on a node must not toggle the step filter.
    window.__dagMoved = function() { return moved > 4; };
  })();

  // Step → findings filter: click any step element (gantt row, dag
  // node, tree node, list "findings" chip) to filter the table.
  function applyStepFilter(id) {
    stepFilter = stepFilter === id ? null : id;
    window.__stepFilter = stepFilter;
    if (window.__dagFocusId) window.__dagFocusId(stepFilter);
    document.querySelectorAll("[data-step]").forEach(function(el) {
      el.classList.toggle("step-active", stepFilter === el.getAttribute("data-step"));
    });
    var chip = document.getElementById("step-filter-chip");
    if (chip) chip.classList.toggle("hidden", !stepFilter);
    var name = document.getElementById("step-filter-name");
    if (name) name.textContent = stepFilter || "";
    renderTable();
    if (stepFilter) {
      var f = document.getElementById("findings");
      if (f) f.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  document.querySelectorAll("[data-step]").forEach(function(el) {
    el.addEventListener("click", function(e) {
      e.stopPropagation();
      // preventDefault keeps <details> in the list view from toggling
      // when the "findings" chip inside <summary> is clicked.
      e.preventDefault();
      // Ignore clicks that ended a DAG pan drag — only for clicks
      // inside the DAG svg; moved resets on the next pointerdown.
      if (
        el.closest("#dag-svg") &&
        window.__dagMoved &&
        window.__dagMoved()
      )
        return;
      applyStepFilter(el.getAttribute("data-step"));
    });
  });

  var clearBtn = document.getElementById("step-filter-clear");
  if (clearBtn) {
    clearBtn.addEventListener("click", function() {
      stepFilter = null;
      window.__stepFilter = null;
      if (window.__dagFocusId) window.__dagFocusId(null);
      document.querySelectorAll("[data-step]").forEach(function(el) {
        el.classList.remove("step-active");
      });
      var chip = document.getElementById("step-filter-chip");
      if (chip) chip.classList.add("hidden");
      renderTable();
    });
  }

  // Filter buttons
  document.querySelectorAll(".filter-btn").forEach(function(btn) {
    btn.addEventListener("click", function() {
      document.querySelectorAll(".filter-btn").forEach(function(b) { b.classList.remove("active"); });
      btn.classList.add("active");
      currentFilter = btn.getAttribute("data-severity");
      renderTable();
    });
  });

  // Search input
  var searchInput = document.getElementById("findings-search");
  if (searchInput) {
    searchInput.addEventListener("input", function() {
      currentSearch = searchInput.value;
      renderTable();
    });
  }

  // Sort by column header
  document.querySelectorAll("#findings-table th.sortable").forEach(function(th) {
    th.addEventListener("click", function() {
      var col = th.getAttribute("data-sort");
      if (sortColumn === col) {
        sortDir = -sortDir;
      } else {
        sortColumn = col;
        sortDir = 1;
      }
      document.querySelectorAll("#findings-table th").forEach(function(t) {
        t.classList.remove("sort-asc", "sort-desc");
      });
      th.classList.add(sortDir === 1 ? "sort-asc" : "sort-desc");
      renderTable();
    });
  });
})();
`;
