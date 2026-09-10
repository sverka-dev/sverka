// @sverka/verification — shared finding search/filter utilities.

import type { Finding, Severity } from "./types.js";

/**
 * Substring match (case-insensitive) across message, checkId, file, rule.
 * Pure — does not mutate input.
 */
export function searchFindings(
  findings: readonly Finding[],
  query: string,
): readonly Finding[] {
  if (query === "") return findings;
  const q = query.toLowerCase();
  return findings.filter(
    (f) =>
      f.message.toLowerCase().includes(q) ||
      f.checkId.toLowerCase().includes(q) ||
      f.file.toLowerCase().includes(q) ||
      f.rule.toLowerCase().includes(q),
  );
}

/**
 * Filter findings by severity. Pure — does not mutate input.
 */
export function filterBySeverity(
  findings: readonly Finding[],
  severity: Severity | "all",
): readonly Finding[] {
  if (severity === "all") return findings;
  return findings.filter((f) => f.severity === severity);
}
