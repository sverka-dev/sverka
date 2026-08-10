import type { Severity } from "@sverka/findings";
import type { Policy, PolicyConfig, Verdict } from "./types.js";
import { PolicyError } from "./errors.js";

/** Severity rank map: info < low < medium < high < critical. */
const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/** All valid severity values (used for validation). */
const VALID_SEVERITIES: ReadonlySet<string> = new Set([
  "info",
  "low",
  "medium",
  "high",
  "critical",
]);

/**
 * Numeric rank of a severity (info=0 ... critical=4). Used for threshold
 * comparison: a finding triggers a rule if `rank(severity) >= rank(threshold)`.
 */
export function severityRank(severity: Severity): number {
  return SEVERITY_RANK[severity];
}

/** The default policy used when no policy is configured. */
export const DEFAULT_POLICY: Readonly<Policy> = Object.freeze({
  name: "default",
  default: "pass",
  failOn: [
    { severity: "high" as Severity, onlyNew: false },
    { severity: "medium" as Severity, onlyNew: true },
  ],
});

/**
 * Validate that a severity string is a known `Severity`. Throws
 * `INVALID_SEVERITY` otherwise.
 */
export function assertValidSeverity(
  severity: unknown,
): asserts severity is Severity {
  if (typeof severity !== "string" || !VALID_SEVERITIES.has(severity)) {
    throw new PolicyError(
      `Invalid severity: ${String(severity)}`,
      "INVALID_SEVERITY",
    );
  }
}

/**
 * Create a policy from a partial configuration, filling defaults.
 * @throws {PolicyError} INVALID_SEVERITY if a rule has an unknown severity.
 */
export function createPolicy(config: PolicyConfig): Policy {
  const name = config.name ?? DEFAULT_POLICY.name;
  const def: Verdict = config.default ?? DEFAULT_POLICY.default;
  const failOn = config.failOn ?? DEFAULT_POLICY.failOn;
  for (const rule of failOn) {
    assertValidSeverity(rule.severity);
  }
  return { name, default: def, failOn };
}
