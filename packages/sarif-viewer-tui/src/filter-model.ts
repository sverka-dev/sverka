// @sverka/sarif-viewer-tui — pure filter/search/sort helpers. Spec 46.

import { filterBySeverity as sharedFilterBySeverity, searchFindings as sharedSearchFindings } from "@sverka/verification";
import type { Finding, Severity } from "@sverka/verification";
import type { SortMode, ViewerFilter } from "./types.js";

/** Ordered list of severity filters cycled by the `f` key. */
export const SEVERITY_FILTERS: readonly ViewerFilter[] = [
  "all",
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

/** Severity rank for sorting: critical > high > medium > low > info. */
export function severityRank(severity: Severity): number {
  switch (severity) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    case "info":
      return 0;
  }
}

/** Filter findings by severity level. `all` returns everything. Pure.
 *  Delegates to the shared `@sverka/verification` implementation. */
export function filterBySeverity(
  findings: readonly Finding[],
  filter: ViewerFilter,
): readonly Finding[] {
  return sharedFilterBySeverity(findings, filter);
}

/** Substring match (case-insensitive) across message, checkId, file, rule. Pure.
 *  Delegates to the shared `@sverka/verification` implementation. */
export function searchFindings(
  findings: readonly Finding[],
  query: string,
): readonly Finding[] {
  return sharedSearchFindings(findings, query);
}

/** Sort findings by mode. Sort is stable (preserves original order for equal
 *  keys). `none` returns the input unchanged. Pure. */
export function sortFindings(
  findings: readonly Finding[],
  mode: SortMode,
): readonly Finding[] {
  if (mode === "none") return findings;
  const indexed = findings.map((f, i) => ({ f, i }));
  switch (mode) {
    case "severity":
      indexed.sort(
        (a, b) => severityRank(b.f.severity) - severityRank(a.f.severity) || a.i - b.i,
      );
      break;
    case "file":
      indexed.sort(
        (a, b) =>
          a.f.file.localeCompare(b.f.file, "en") ||
          a.f.startLine - b.f.startLine ||
          a.i - b.i,
      );
      break;
    case "rule":
      indexed.sort(
        (a, b) => a.f.rule.localeCompare(b.f.rule, "en") || a.i - b.i,
      );
      break;
  }
  return indexed.map(({ f }) => f);
}
