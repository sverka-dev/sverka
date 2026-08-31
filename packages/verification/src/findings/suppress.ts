import type { Finding } from "./types.js";
import type { Baseline } from "./baseline.js";

/**
 * Check if a finding is suppressed by the baseline.
 * A finding is suppressed if its fingerprint matches a suppression entry
 * that has not expired (`expiresAt` is in the future or absent).
 */
export function isSuppressed(finding: Finding, baseline: Baseline): boolean {
  const now = Date.now();
  for (const s of baseline.suppressions) {
    if (s.fingerprint === finding.fingerprint) {
      if (s.expiresAt === undefined) {
        return true;
      }
      // Expired if expiresAt <= now (boundary: exactly now = expired).
      if (new Date(s.expiresAt).getTime() > now) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Filter out suppressed findings.
 * @param includeSuppressed When true, all findings are returned unchanged.
 */
export function filterSuppressed(
  findings: readonly Finding[],
  baseline: Baseline,
  includeSuppressed: boolean,
): Finding[] {
  if (includeSuppressed) {
    return [...findings];
  }
  return findings.filter((f) => !isSuppressed(f, baseline));
}

/**
 * Return only findings not present in the baseline (new findings).
 * Suppressed findings are excluded.
 */
export function filterOnlyNew(
  findings: readonly Finding[],
  baseline: Baseline,
): Finding[] {
  const known = new Set(baseline.fingerprints);
  return findings.filter(
    (f) => !known.has(f.fingerprint) && !isSuppressed(f, baseline),
  );
}
