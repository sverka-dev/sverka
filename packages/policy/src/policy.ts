import type { Severity } from "@sverka/findings";
import type { FailOnRule, Policy, PolicyConfig, Verdict } from "./types.js";
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
 * Validate a single failOn rule has an object shape with a known severity.
 * @throws {PolicyError} INVALID_RULE if the rule is not a valid object.
 * @throws {PolicyError} INVALID_SEVERITY if the rule's severity is unknown.
 */
function validateFailOnRule(rule: unknown): asserts rule is FailOnRule {
  if (!rule || typeof rule !== "object" || !("severity" in rule)) {
    throw new PolicyError(
      `Invalid rule in failOn: expected object with severity, got ${String(rule)}`,
      "INVALID_RULE",
    );
  }
  assertValidSeverity((rule as Record<string, unknown>).severity);
}

/**
 * Validate the failOn value is an array of valid rules.
 * @throws {PolicyError} INVALID_POLICY if failOn is not an array.
 */
function validateFailOn(failOn: unknown): asserts failOn is FailOnRule[] {
  if (!Array.isArray(failOn)) {
    throw new PolicyError("Policy failOn must be an array", "INVALID_POLICY");
  }
  for (const rule of failOn) {
    validateFailOnRule(rule);
  }
}

/**
 * Create a policy from a partial configuration, filling defaults.
 * @throws {PolicyError} INVALID_POLICY if the config is not an object or failOn is not an array.
 * @throws {PolicyError} INVALID_SEVERITY if a rule has an unknown severity.
 */
export function createPolicy(config: PolicyConfig): Policy {
  if (!config || typeof config !== "object") {
    throw new PolicyError("Policy config must be an object", "INVALID_POLICY");
  }
  const name = config.name ?? DEFAULT_POLICY.name;
  const def: Verdict = config.default ?? DEFAULT_POLICY.default;
  const failOn = config.failOn ?? DEFAULT_POLICY.failOn;
  validateFailOn(failOn);
  return { name, default: def, failOn };
}
