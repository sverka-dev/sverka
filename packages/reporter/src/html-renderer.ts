// @sverka/reporter — HtmlRenderer (I/O). Spec 44.

import type { RunEvent } from "@sverka/runtime";
import type { Finding, PolicyResult } from "@sverka/verification";
import type { Renderer, UIState, HtmlRendererOptions } from "./types.js";
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

      const html = generateHtml(state, findings, verdict, dagLayout);

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
  pending: "\u25CB",
  ready: "\u25C7",
  running: "\u25B6",
  succeeded: "\u2713",
  failed: "\u2717",
  skipped: "\u2298",
  cancelled: "\u2298",
  "cache-hit": "\u25D2",
  suspended: "\u23F8",
  compensating: "\u21BA",
  compensated: "\u21BA",
};

/** Render the HTML head section. */
function renderHead(): string {
// nosemgrep: html-in-template-string
  return `<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sverka Run Report</title>
  <style>${CSS}</style>
</head>`;
}

/** Render the header with run summary. */
function renderHeader(planId: string, status: string, duration: number): string {
// nosemgrep: html-in-template-string
  return `<header>
    <h1>Sverka Run Report</h1>
    <div class="run-summary">
      <span class="label">Plan:</span> <span class="value">${escapeHtml(planId)}</span>
      <span class="label">Status:</span> <span class="value status-${escapeHtml(status)}">${escapeHtml(status)}</span>
      <span class="label">Duration:</span> <span class="value">${duration}ms</span>
    </div>
  </header>`;
}

/** Render the DAG section with ReactFlow container and noscript fallback. */
function renderDagSection(dagLayout: { nodes: readonly { id: string; label: string; x: number; y: number; layer: number }[]; edges: readonly { source: string; target: string; label?: string }[] }): string {
// nosemgrep: html-in-template-string
  return `<section id="dag">
    <h2>Workflow DAG</h2>
    <div id="reactflow-container" style="width:100%;height:400px;"></div>
    <noscript>
      <p>JavaScript is required for the interactive DAG.</p>
      <ul>
        ${dagLayout.nodes.map((n) => `<li>${escapeHtml(n.label)} (layer ${n.layer}, x=${n.x}, y=${n.y})</li>`).join("\n        ")} // nosemgrep: html-in-template-string
      </ul>
    </noscript>
  </section>`;
}

/** Render the findings section with filter controls and table. */
function renderFindingsSection(findingsHtml: string): string {
// nosemgrep: html-in-template-string
  return `<section id="findings">
    <h2>Findings</h2>
    <div class="findings-controls">
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

/** Render the script tags for React, ReactFlow, and inline data. */
function renderScripts(dagData: string, findingsData: string): string {
// nosemgrep: html-in-template-string
  return `<script>
    var __DAG_DATA__ = ${dagData};
    var __FINDINGS_DATA__ = ${findingsData};
  </script>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/reactflow@11/dist/reactflow.min.js"></script>
  <link rel="stylesheet" href="https://unpkg.com/reactflow@11/dist/style.css">
  <script>${JS}</script>`;
}

function generateHtml(
  state: UIState,
  findings: readonly Finding[],
  verdict: PolicyResult | null,
  dagLayout: { nodes: readonly { id: string; label: string; x: number; y: number; layer: number }[]; edges: readonly { source: string; target: string; label?: string }[] },
): string {
  const planId = state.planId ?? "unknown";
  const status = state.status ?? "unknown";
  const duration = state.durationMs ?? 0;

  const stepsHtml = renderSteps(state);
  const findingsHtml = renderFindings(findings);
  const verdictHtml = renderVerdict(verdict);
  const dagData = escapeScriptData(JSON.stringify(dagLayout));
  const findingsData = escapeScriptData(JSON.stringify(findings.map((f) => ({
    severity: f.severity,
    checkId: f.checkId,
    file: f.file,
    startLine: f.startLine,
    endLine: f.endLine,
    message: f.message,
    rule: f.rule,
  }))));

  return `<!DOCTYPE html>
<html lang="en">
${renderHead()}
<body>
  ${renderHeader(planId, status, duration)}

  ${verdictHtml}

  ${renderDagSection(dagLayout)}

  ${renderFindingsSection(findingsHtml)}

  <section id="steps">
    <h2>Steps</h2>
    ${stepsHtml}
  </section>

  ${renderScripts(dagData, findingsData)}
</body>
</html>`;
}

function renderSteps(state: UIState): string {
  if (state.steps.size === 0) {
    return "<p>No steps recorded.</p>";
  }

  const steps = [...state.steps.values()].sort((a, b) =>
    a.stepId.localeCompare(b.stepId),
  );

  return steps
    .map((step) => {
      const icon = STATUS_ICONS[step.state] ?? "\u25CB";
      const duration = step.durationMs != null ? ` (${step.durationMs}ms)` : "";
      const errorHtml = step.error
        ? `<div class="step-error">${escapeHtml(step.error)}</div>` // nosemgrep: html-in-template-string
        : "";
      const attemptHtml = step.attempt != null
        ? `<div class="step-attempt">Attempt: ${step.attempt}</div>` // nosemgrep: html-in-template-string
        : "";

      return `      <details> // nosemgrep: html-in-template-string
        <summary><span class="step-icon">${icon}</span> ${escapeHtml(step.stepId)} <span class="step-state ${step.state}">${step.state}</span>${duration}</summary>
        <div class="step-body">
          ${errorHtml}
          ${attemptHtml}
        </div>
      </details>`;
    })
    .join("\n");
}

function renderFindings(findings: readonly Finding[]): string {
  if (findings.length === 0) {
    return '<tr><td colspan="5" class="no-findings">No findings</td></tr>';
  }

  return findings
    .map(
      (f) => `        <tr data-severity="${escapeHtml(f.severity)}"> // nosemgrep: html-in-template-string
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
  return text // nosemgrep: replace-all
    .replaceAll("&", "\u0026amp;")
    .replaceAll("<", "\u0026lt;")
    .replaceAll(">", "\u0026gt;")
    .replaceAll("\"", "\u0026quot;")
    .replaceAll("'", "\u0026#39;");
}

/** Escape JSON data for safe embedding in <script> tags.
 * Prevents </script> breakout XSS by replacing < with \u003c. */
function escapeScriptData(json: string): string {
  return json.replaceAll("<", "\\u003c"); // nosemgrep: replace-all
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
.run-summary { font-size: 0.875rem; color: #8b949e; }
.run-summary .label { font-weight: 600; margin-right: 0.25rem; }
.run-summary .value { margin-right: 1rem; }
.status-success { color: #3fb950; }
.status-failure { color: #f85149; }
.status-cancelled { color: #d29922; }
section { padding: 1rem 2rem; border-bottom: 1px solid #21262d; }
section h2 { font-size: 1.25rem; color: #f0f6fc; margin: 0 0 1rem 0; }
.verdict-banner {
  padding: 0.75rem 1rem;
  border-radius: 6px;
  font-weight: 600;
  font-size: 1rem;
}
.verdict-pass { background: #1a3a2e; color: #3fb950; border: 1px solid #2ea043; }
.verdict-fail { background: #3a1a1a; color: #f85149; border: 1px solid #da3633; }
.verdict-none { background: #21262d; color: #8b949e; }
#reactflow-container { background: #161b22; border: 1px solid #30363d; border-radius: 6px; }
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
@media (max-width: 768px) {
  section { padding: 1rem; }
  .findings-controls { flex-direction: column; }
  .search-input { min-width: 100%; }
  table { font-size: 0.75rem; }
  th, td { padding: 0.3rem 0.5rem; }
}
`;

// nosemgrep: html-in-template-string
const JS = `
(function() {
  function esc(text) {
    var d = document.createElement("div");
    d.textContent = text == null ? "" : String(text);
    return d.innerHTML;
  }
  // Findings filter/sort/search
  var findingsData = window.__FINDINGS_DATA__ || [];
  var currentFilter = "all";
  var currentSearch = "";
  var sortColumn = null;
  var sortDir = 1;

  function renderTable() {
    var tbody = document.querySelector("#findings-table tbody");
    if (!tbody) return;
    var filtered = findingsData.filter(function(f) {
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

  // ReactFlow DAG rendering
  function initReactFlow() {
    if (typeof React === "undefined" || typeof ReactDOM === "undefined" || typeof ReactFlow === "undefined") return;
    var dagData = window.__DAG_DATA__ || { nodes: [], edges: [] };
    var nodes = dagData.nodes.map(function(n) {
      return {
        id: n.id,
        type: "default",
        position: { x: n.x, y: n.y },
        data: { label: n.label }
      };
    });
    var edges = dagData.edges.map(function(e, i) {
      return {
        id: e.source + "-" + e.target + "-" + i,
        source: e.source,
        target: e.target,
        label: e.label || "",
        animated: false
      };
    });
    var container = document.getElementById("reactflow-container");
    if (!container) return;
    var root = ReactDOM.createRoot(container);
    root.render(React.createElement(ReactFlow.default, {
      nodes: nodes,
      edges: edges,
      fitView: true,
      style: { background: "#161b22" }
    }));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initReactFlow);
  } else {
    initReactFlow();
  }
})();
`;
