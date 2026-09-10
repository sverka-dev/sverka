// @sverka/sarif-viewer-web — HTML generation. Spec 47.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Finding } from "@sverka/verification";
import { resolveFindings } from "./input.js";
import type { SarifWebOptions } from "./types.js";

/** Escape HTML special characters to prevent XSS. Pure. */
function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Escape JSON data for safe embedding in <script> tags.
 *  Prevents </script> breakout XSS by replacing < with \u003c. */
function escapeScriptData(json: string): string {
  return json.replaceAll("<", String.raw`\u003c`);
}

/** Extract tool name from the first finding's source, or "unknown". */
function toolName(findings: readonly Finding[]): string {
  return findings[0]?.source.tool ?? "unknown";
}

/** Count findings by severity for the summary header. Pure. */
function severityBreakdown(findings: readonly Finding[]): Record<string, number> {
  const counts: Record<string, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const f of findings) {
    if (f.severity in counts) {
      counts[f.severity] += 1;
    }
  }
  return counts;
}

/** Render the summary header with total count, severity breakdown, and tool. */
function renderSummary(findings: readonly Finding[]): string {
  const breakdown = severityBreakdown(findings);
  const total = findings.length;
  const tool = escapeHtml(toolName(findings));
  const parts = [
    `<span class="summary-count">${total}</span> findings`,
    `<span class="summary-tool">${tool}</span>`,
    `<span class="severity-critical">${breakdown.critical} critical</span>`,
    `<span class="severity-high">${breakdown.high} high</span>`,
    `<span class="severity-medium">${breakdown.medium} medium</span>`,
    `<span class="severity-low">${breakdown.low} low</span>`,
    `<span class="severity-info">${breakdown.info} info</span>`,
  ];
  return `<div class="summary-header">${parts.join(" · ")}</div>`;
}

/** Render the findings table body rows. Pure. */
function renderFindingsRows(findings: readonly Finding[]): string {
  if (findings.length === 0) {
    return '<tr><td colspan="5" class="no-findings">No findings</td></tr>';
  }
  return findings
    .map(
      (f) =>
        `        <tr data-severity="${escapeHtml(f.severity)}">
          <td class="severity-${escapeHtml(f.severity)}">${escapeHtml(f.severity)}</td>
          <td>${escapeHtml(f.checkId)}</td>
          <td>${escapeHtml(f.file)}:${f.startLine}</td>
          <td>${escapeHtml(f.rule)}</td>
          <td>${escapeHtml(f.message)}</td>
        </tr>`,
    )
    .join("\n");
}

/** Inline CSS for the self-contained HTML report. */
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
.summary-header {
  padding: 1rem 2rem;
  background: #161b22;
  border-bottom: 1px solid #30363d;
  font-size: 0.875rem;
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  align-items: center;
}
.summary-count { font-size: 1.5rem; font-weight: 700; color: #f0f6fc; }
.summary-tool { color: #8b949e; font-weight: 600; }
section { padding: 1rem 2rem; border-bottom: 1px solid #21262d; }
section h2 { font-size: 1.25rem; color: #f0f6fc; margin: 0 0 1rem 0; }
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
@media (max-width: 768px) {
  section { padding: 1rem; }
  .findings-controls { flex-direction: column; }
  .search-input { min-width: 100%; }
  table { font-size: 0.75rem; }
  th, td { padding: 0.3rem 0.5rem; }
}
`;

/** Inline vanilla JS for filter, sort, and search. No external dependencies. */
const JS = `
(function() {
  var findingsData = window.__FINDINGS_DATA__ || [];
  var currentFilter = "all";
  var currentSearch = "";
  var sortColumn = null;
  var sortDir = 1;

  function esc(text) {
    var d = document.createElement("div");
    d.textContent = text == null ? "" : String(text);
    return d.innerHTML;
  }

  function renderTable() {
    var tbody = document.querySelector("#findings-table tbody");
    if (!tbody) return;
    var filtered = findingsData.filter(function(f) {
      if (currentFilter !== "all" && f.severity !== currentFilter) return false;
      if (currentSearch) {
        var s = currentSearch.toLowerCase();
        return (f.severity + " " + f.checkId + " " + f.file + " " + f.rule + " " + f.message).toLowerCase().indexOf(s) !== -1;
      }
      return true;
    });
    if (sortColumn) {
      filtered.sort(function(a, b) {
        var va = a[sortColumn], vb = b[sortColumn];
        if (sortColumn === "severity") {
          var rank = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
          return ((rank[vb] || 0) - (rank[va] || 0)) * sortDir;
        }
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
        '<td>' + esc(f.file) + (f.startLine ? ':' + f.startLine : '') + '</td>' +
        '<td>' + esc(f.rule) + '</td>' +
        '<td>' + esc(f.message) + '</td>' +
        '</tr>';
    }).join("");
  }

  document.querySelectorAll(".filter-btn").forEach(function(btn) {
    btn.addEventListener("click", function() {
      document.querySelectorAll(".filter-btn").forEach(function(b) { b.classList.remove("active"); });
      btn.classList.add("active");
      currentFilter = btn.getAttribute("data-severity");
      renderTable();
    });
  });

  var searchInput = document.getElementById("findings-search");
  if (searchInput) {
    searchInput.addEventListener("input", function() {
      currentSearch = searchInput.value;
      renderTable();
    });
  }

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

/**
 * Generate a self-contained HTML report from findings. Pure — no I/O.
 * All CSS and JS are inlined. No external dependencies, no CDN.
 */
export function generateSarifHtml(findings: readonly Finding[]): string {
  const rowsHtml = renderFindingsRows(findings);
  const summaryHtml = renderSummary(findings);
  const findingsData = escapeScriptData(
    JSON.stringify(
      findings.map((f) => ({
        severity: f.severity,
        checkId: f.checkId,
        file: f.file,
        rule: f.rule,
        message: f.message,
        startLine: f.startLine,
      })),
    ),
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SARIF Report — ${escapeHtml(toolName(findings))}</title>
  <style>${CSS}</style>
</head>
<body>
  ${summaryHtml}

  <section id="findings">
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
          <th data-sort="rule" class="sortable">Rule</th>
          <th data-sort="message" class="sortable">Message</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  </section>

  <script>
    var __FINDINGS_DATA__ = ${findingsData};
  </script>
  <script>${JS}</script>
</body>
</html>`;
}

/**
 * Resolve `options` into findings, generate HTML, and write to
 * `options.outputPath`. Creates parent directories if needed.
 *
 * @throws {Error} when the file cannot be written.
 */
export function renderSarifWeb(options: SarifWebOptions): void {
  const findings = resolveFindings(options);
  const html = generateSarifHtml(findings);
  mkdirSync(dirname(options.outputPath), { recursive: true });
  writeFileSync(options.outputPath, html, "utf-8");
}
