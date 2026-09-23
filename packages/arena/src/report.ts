/**
 * Text rendering for arena results — aggregate table + per-task analysis.
 * Used by `sverka-arena run` (post-run summary) and `sverka-arena report`.
 */

import type { AggregateMetrics, ArenaResult } from "./types.js";

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function row(
  cells: readonly (string | number)[],
  widths: readonly number[],
): string {
  return cells
    .map((c, i) => String(c).padEnd(widths[i] ?? 10))
    .join("")
    .trimEnd();
}

function aggregateTable(aggregates: readonly AggregateMetrics[]): string {
  const header = [
    "label",
    "runs",
    "pass",
    "tokens",
    "tools",
    "llm",
    "ms",
    "judge",
  ];
  const data = aggregates.map((a) => [
    a.label,
    a.totalRuns,
    a.successCount,
    fmtNum(a.avgTotalTokens),
    fmtNum(a.avgToolCalls),
    fmtNum(a.avgLlmCalls),
    fmtNum(a.avgExecutionTimeMs),
    a.judgePassCount > 0 || a.avgJudgeScore > 0 ? fmtNum(a.avgJudgeScore) : "-",
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length + 2, ...data.map((r) => String(r[i] ?? "").length + 2)),
  );
  const lines = [row(header, widths)];
  for (const r of data) lines.push(row(r, widths));
  return lines.join("\n");
}

/** Render an ArenaResult as human-readable text. */
export function renderReport(result: ArenaResult): string {
  const parts: string[] = [];

  parts.push("Aggregates", aggregateTable(result.aggregates));

  if (result.analysis.length > 0) {
    parts.push("", "Analysis");
    for (const task of result.analysis) {
      parts.push(`  ${task.taskName} (${task.taskId})`);
      for (const cmp of task.comparisons) {
        const verdict = cmp.candidateBetter ? "better" : "worse";
        parts.push(
          `    ${cmp.baseline} → ${cmp.candidate}: ` +
            `tokens ${cmp.deltaTokens}, tools ${cmp.deltaToolCalls}, ` +
            `llm ${cmp.deltaLlmCalls}, ms ${cmp.deltaTimeMs}, ` +
            `judge ${cmp.deltaJudgeScore} — ${verdict}`,
        );
      }
      if (task.summary !== undefined) {
        parts.push(`    ${task.summary}`);
      }
    }
  }

  return parts.join("\n");
}
