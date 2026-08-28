import type { Finding, Severity } from "../findings/index.js";

/** The pass/fail verdict. */
export type Verdict = "pass" | "fail";

/** A policy definition. */
export interface Policy {
  /** Human-readable name. */
  name: string;
  /** Verdict when no rules trigger. */
  default: Verdict;
  /** Rules that cause failure based on severity. */
  failOn: FailOnRule[];
}

/** A rule that causes failure based on severity thresholds. */
export interface FailOnRule {
  /** Minimum severity that triggers failure (inclusive). */
  severity: Severity;
  /** Only consider findings not in the baseline fingerprint set. */
  onlyNew: boolean;
  /** Restrict to these check IDs. If absent, all checks are considered. */
  checkIds?: string[];
}

/** A finding that triggered a policy rule. */
export interface TriggeredFinding {
  /** The finding. */
  finding: Finding;
  /** Index of the rule in `policy.failOn` that triggered. */
  ruleIndex: number;
}

/** The result of evaluating a single rule. */
export interface RuleResult {
  /** Index of the rule in `policy.failOn`. */
  ruleIndex: number;
  /** Whether the rule triggered. */
  triggered: boolean;
  /** Findings matched by the rule. */
  matched: Finding[];
}

/** The result of policy evaluation. */
export interface PolicyResult {
  /** Final verdict. */
  verdict: Verdict;
  /** Findings that triggered a failure. */
  triggered: TriggeredFinding[];
  /** Per-rule outcomes. */
  rules: RuleResult[];
  /** Human-readable summary. */
  summary: string;
}

/** User-facing policy configuration (before defaults are applied). */
export interface PolicyConfig {
  name?: string;
  default?: Verdict;
  failOn?: FailOnRule[];
}
