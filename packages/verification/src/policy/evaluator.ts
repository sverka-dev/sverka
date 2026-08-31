import type { Finding, Severity } from "../findings/index.js";
import type {
  Policy,
  PolicyResult,
  RuleResult,
  TriggeredFinding,
} from "./types.js";
import { PolicyError } from "./errors.js";
import { severityRank, assertValidSeverity } from "./policy.js";

/** Strip the `checks/` prefix so `checks/typecheck` and `typecheck` compare equal. */
function normalizeCheckId(id: string): string {
  return id.startsWith("checks/") ? id.slice(7) : id;
}

/** Match a finding checkId against a policy checkId, allowing rule-qualified ids. */
function matchesCheckId(findingCheckId: string, policyCheckId: string): boolean {
  const bareFinding = normalizeCheckId(findingCheckId);
  const barePolicy = normalizeCheckId(policyCheckId);
  if (bareFinding === barePolicy) return true;
  return bareFinding.startsWith(`${barePolicy}:`);
}

/** Severity display order for summary counts (most severe first). */
const SUMMARY_SEVERITY_ORDER: Severity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

/**
 * Validate a policy's structure. Throws `INVALID_POLICY` if `policy` is not
 * an object or `failOn` is missing or not an array, and `INVALID_SEVERITY`
 * if any rule has an unknown severity.
 */
function validatePolicy(policy: Policy): asserts policy is Policy {
  if (!policy || typeof policy !== "object") {
    throw new PolicyError("Policy must be an object", "INVALID_POLICY");
  }
  if (!Array.isArray(policy.failOn)) {
    throw new PolicyError(
      "Policy failOn must be an array",
      "INVALID_POLICY",
    );
  }
  for (const rule of policy.failOn) {
    assertValidSeverity(rule.severity);
  }
}

/**
 * Evaluate findings against a policy.
 * @param findings Normalized findings (pre-filtered for suppression by caller).
 * @param policy The policy to evaluate.
 * @param baselineFingerprints Fingerprints of baseline findings (for onlyNew).
 *   Pass an empty array when no baseline exists.
 * @returns The evaluation result.
 * @throws {PolicyError} INVALID_POLICY if the policy is malformed.
 * @throws {PolicyError} INVALID_SEVERITY if a rule has an unknown severity.
 */
export function evaluatePolicy(
  findings: readonly Finding[],
  policy: Policy,
  baselineFingerprints: readonly string[],
): PolicyResult {
  validatePolicy(policy);

  const baseline = new Set(baselineFingerprints);
  const rules: RuleResult[] = [];
  const triggered: TriggeredFinding[] = [];

  for (let i = 0; i < policy.failOn.length; i++) {
    const rule = policy.failOn[i]!;
    const rawCheckIds = rule.checkIds as string | string[] | undefined | null;
    const checkIds = rawCheckIds === undefined || rawCheckIds === null
      ? []
      : Array.isArray(rawCheckIds)
        ? rawCheckIds
        : [rawCheckIds];

    let matched: Finding[] = findings.filter((f) => {
      // checkIds filter (supports bare, checks/ prefix, and rule-qualified ids)
      if (checkIds.length > 0 && !checkIds.some((id) => matchesCheckId(f.checkId, id))) {
        return false;
      }
      // onlyNew filter
      if (rule.onlyNew && baseline.has(f.fingerprint)) {
        return false;
      }
      // severity threshold (inclusive)
      return severityRank(f.severity) >= severityRank(rule.severity);
    });

    // Preserve input order (filter already does); defensive copy.
    matched = [...matched];

    rules.push({ ruleIndex: i, triggered: matched.length > 0, matched });
    for (const finding of matched) {
      triggered.push({ finding, ruleIndex: i });
    }
  }

  const anyTriggered = rules.some((r) => r.triggered);
  const verdict = anyTriggered ? "fail" : policy.default;
  const summary = buildSummary(triggered, rules, verdict);

  return { verdict, triggered, rules, summary };
}

/** Pluralize a noun: "1 finding" / "3 findings". */
function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Build the human-readable summary. Counts UNIQUE triggered findings by
 * severity (a finding matched by multiple rules is counted once) and lists
 * the number of triggered rules.
 */
function buildSummary(
  triggered: TriggeredFinding[],
  rules: RuleResult[],
  verdict: "pass" | "fail",
): string {
  if (verdict === "pass" || triggered.length === 0) {
    return "pass: no findings triggered any rule";
  }

  // Unique findings by stable id (checkId:fingerprint), not just fingerprint,
  // so two different checks with the same fingerprint are counted separately.
  const seen = new Set<string>();
  const uniqueFindings: Finding[] = [];
  for (const t of triggered) {
    if (!seen.has(t.finding.id)) {
      seen.add(t.finding.id);
      uniqueFindings.push(t.finding);
    }
  }

  const counts = new Map<Severity, number>();
  for (const f of uniqueFindings) {
    counts.set(f.severity, (counts.get(f.severity) ?? 0) + 1);
  }

  const parts: string[] = [];
  for (const sev of SUMMARY_SEVERITY_ORDER) {
    const n = counts.get(sev);
    if (n) parts.push(`${n} ${sev}`);
  }

  const triggeredRuleCount = rules.filter((r) => r.triggered).length;
  return `fail: ${pluralize(uniqueFindings.length, "finding")} triggered ${pluralize(triggeredRuleCount, "rule")} (${parts.join(", ")})`;
}
