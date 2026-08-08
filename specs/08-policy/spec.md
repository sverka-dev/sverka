# Spec 08 — Policy Package: Policy Evaluation

## Overview

The `policy` package evaluates a set of normalized findings against
user-configurable policy rules and produces a verdict (`pass` or `fail`). It
decides whether a verification run succeeds or fails based on severity
thresholds, `--only-new` filtering, and custom rules. Policy evaluation is the
final gate before the CLI reports results and sets its exit code.

Policies are declarative: a user defines rules in a `sverka.config.ts` file or
in a standalone policy file, and the evaluator applies them deterministically
to the findings set.

## Goals

1. Evaluate a set of findings against policy rules and produce a pass/fail
   verdict.
2. Support `failOn` rules that specify which severity levels cause failure.
3. Support `onlyNew` filtering within policy rules so only newly introduced
   findings cause failure.
4. Support custom policy rules written as TypeScript predicates over the
   findings set.
5. Produce a structured verdict output with the triggering findings and
   violated rules.
6. Be deterministic: identical findings and policy produce identical verdicts.
7. Support a default policy that requires zero configuration.
8. Export all public types and functions from `src/index.ts`.

## Non-goals (v1)

- Automatically fixing or suppressing findings.
- Sending notifications or integrating with external systems on failure.
- Enforcing code coverage thresholds (that is a check, not a policy).
- Managing policy versions or policy-as-code repositories.
- Supporting non-TypeScript policy definitions.

## Interfaces

```typescript
/**
 * Evaluates findings against a policy and produces a verdict.
 */
export interface PolicyEvaluator {
  /**
   * Evaluate findings against the given policy.
   * @param findings The set of normalized findings.
   * @param policy The policy to evaluate.
   * @returns The evaluation result with verdict and details.
   */
  evaluate(findings: Finding[], policy: Policy): PolicyResult;
}

/**
 * A policy definition.
 */
export interface Policy {
  /** Human-readable name for the policy. */
  name: string;
  /** The default behavior when no rules match. */
  default: Verdict;
  /** failOn rules that cause failure based on severity. */
  failOn: FailOnRule[];
  /** Custom rules evaluated against the findings set. */
  custom: CustomRule[];
  /** Whether to exclude suppressed findings. Defaults to true. */
  excludeSuppressed: boolean;
}

/**
 * A rule that causes failure based on severity thresholds.
 */
export interface FailOnRule {
  /** Minimum severity that triggers failure. Findings at or above this
   *  severity cause failure. */
  severity: Severity;
  /** Whether to only consider new findings (not in baseline). */
  onlyNew: boolean;
  /** Optional check IDs to restrict this rule to. If absent, all checks
   *  are considered. */
  checkIds?: string[];
  /** Optional file glob patterns to restrict this rule to. */
  paths?: string[];
}

/**
 * A custom policy rule written as a TypeScript predicate.
 */
export interface CustomRule {
  /** Unique identifier for the rule. */
  id: string;
  /** Human-readable description. */
  description: string;
  /** The verdict when this rule's predicate returns true. */
  verdict: Verdict;
  /**
   * Predicate that inspects the findings set and returns matching findings.
   * If the returned array is non-empty, the rule is considered triggered.
   */
  match: (findings: Finding[], context: PolicyContext) => Finding[];
}

/**
 * Context provided to custom rule predicates.
 */
export interface PolicyContext {
  /** Project root path. */
  root: string;
  /** Whether a baseline was present. */
  hasBaseline: boolean;
  /** Fingerprints of baseline findings. */
  baselineFingerprints: string[];
  /** Total finding count. */
  totalFindings: number;
}

/**
 * The result of policy evaluation.
 */
export interface PolicyResult {
  /** The final verdict. */
  verdict: Verdict;
  /** Findings that triggered a failure. */
  triggered: TriggeredFinding[];
  /** Rules that were evaluated and their outcomes. */
  rules: RuleResult[];
  /** Summary message. */
  summary: string;
}

/**
 * The pass/fail verdict.
 */
export type Verdict = "pass" | "fail";

/**
 * A finding that triggered a policy rule.
 */
export interface TriggeredFinding {
  /** The finding that triggered the rule. */
  finding: Finding;
  /** The ID of the rule that was triggered. */
  ruleId: string;
  /** The rule type. */
  ruleType: "failOn" | "custom";
}

/**
 * The result of evaluating a single rule.
 */
export interface RuleResult {
  /** The rule identifier. */
  ruleId: string;
  /** Whether the rule was triggered. */
  triggered: boolean;
  /** Findings matched by the rule. */
  matched: Finding[];
  /** The verdict this rule produces. */
  verdict: Verdict;
}

/**
 * Severity levels (re-exported from findings package for convenience).
 */
export type Severity = "info" | "low" | "medium" | "high" | "critical";

/**
 * Finding type (structural subset re-exported from findings package).
 * The policy package depends on @sverka/findings and imports the full
 * Finding interface. This re-export ensures the policy package does not
 * redefine Finding.
 */
export type { Finding } from "@sverka/findings";

/**
 * The default policy used when no policy is configured.
 */
export const DEFAULT_POLICY: Policy;

/**
 * Creates a policy from a user configuration object.
 * @param config Partial policy configuration.
 * @returns A complete Policy with defaults filled in.
 */
export function createPolicy(config: PolicyConfig): Policy;

/**
 * User-facing policy configuration (before defaults are applied).
 */
export interface PolicyConfig {
  name?: string;
  default?: Verdict;
  failOn?: FailOnRule[];
  custom?: CustomRule[];
  excludeSuppressed?: boolean;
}

/**
 * Error thrown when policy evaluation fails.
 */
export class PolicyError extends Error {
  readonly code: string;
  readonly cause: unknown;
  constructor(message: string, code: string, cause?: unknown) {
    super(message);
    this.name = "PolicyError";
    this.code = code;
    this.cause = cause;
  }
}
```

## Data models

### Severity ordering

Severities are ordered for threshold comparison:

```
info < low < medium < high < critical
```

A finding triggers a `failOn` rule if `finding.severity >= rule.severity`
according to this ordering.

### Default policy

When no policy is configured, the default policy is:

```typescript
{
  name: "default",
  default: "pass",
  failOn: [
    { severity: "high", onlyNew: false },
    { severity: "medium", onlyNew: true }
  ],
  custom: [],
  excludeSuppressed: true
}
```

This means:
- Any finding with severity `high` or `critical` always fails.
- Any new finding with severity `medium` or above fails.
- `info` and `low` findings never fail by default.

### Evaluation algorithm

1. **Filter suppressed findings** if `excludeSuppressed` is true.
2. **Evaluate `failOn` rules** in order. For each rule:
   a. Filter findings by `checkIds` if specified.
   b. Filter findings by `paths` glob patterns if specified.
   c. If `onlyNew` is true, filter to findings whose fingerprints are not in
      `baselineFingerprints`.
   d. Filter to findings with `severity >= rule.severity`.
   e. If any findings remain, the rule is triggered with verdict `fail`.
3. **Evaluate custom rules** in order. For each rule:
   a. Call `rule.match(findings, context)`.
   b. If the returned array is non-empty, the rule is triggered with the
      rule's `verdict`.
4. **Compute final verdict:**
   - If any triggered rule has verdict `fail`, the final verdict is `fail`.
   - Otherwise, the final verdict is `policy.default`.
5. **Assemble `PolicyResult`** with all triggered findings, rule results, and
   a summary message.

### Verdict output

The `PolicyResult` is consumed by the CLI to determine exit code:

| Verdict | Exit code |
|---|---|
| `pass` | 0 |
| `fail` | 1 |

The `summary` field is a human-readable string, e.g.:

```
"fail: 3 findings triggered 2 rules (2 high, 1 medium)"
```

### Custom rule context

The `PolicyContext` provides custom rules with baseline information so they
can implement `onlyNew` logic themselves if needed. The `baselineFingerprints`
array is empty when no baseline exists.

## Error handling

- **`PolicyError`** is thrown for policy configuration and evaluation errors:
  - `INVALID_POLICY` — policy configuration is malformed (missing `failOn`,
    invalid severity).
  - `INVALID_SEVERITY` — a `failOn` rule specifies an unknown severity.
  - `CUSTOM_RULE_ERROR` — a custom rule's `match` function threw an error.
    The original error is preserved in `cause`.
  - `INVALID_VERDICT` — a custom rule specifies a verdict other than `pass`
    or `fail`.
- **Custom rule errors are caught.** If a custom rule's `match` function
  throws, a `PolicyError` with code `CUSTOM_RULE_ERROR` is thrown, wrapping
  the original error in `cause`. Evaluation does not continue.
- **Empty findings are valid.** An empty findings set with default policy
  produces verdict `pass`.
- All errors include a `cause` field typed as `unknown`.
- No `any` types are used.

## Test plan

Tests live in `packages/policy/src/__tests__/` and run via `bun test`.

1. **Default policy:**
   - No findings → verdict `pass`.
   - Only `info` findings → verdict `pass`.
   - Only `low` findings → verdict `pass`.
   - A `medium` finding with no baseline → verdict `fail` (onlyNew: true, but
     no baseline means all are new).
   - A `medium` finding in the baseline → verdict `pass` (onlyNew filters it
     out).
   - A `high` finding → verdict `fail` (always fails, regardless of baseline).
   - A `critical` finding → verdict `fail`.
2. **`failOn` rules:**
   - `severity: "low"` fails on `low`, `medium`, `high`, `critical`.
   - `severity: "critical"` fails only on `critical`.
   - `onlyNew: true` with baseline excludes baseline findings.
   - `onlyNew: false` includes baseline findings.
   - `checkIds` filter restricts to specified checks.
   - `paths` glob filter restricts to matching files.
   - Multiple `failOn` rules are evaluated independently.
3. **Custom rules:**
   - A custom rule with `verdict: "fail"` that matches findings produces
     `fail`.
   - A custom rule with `verdict: "pass"` that matches findings does not
     override a `fail` from another rule.
   - A custom rule that returns an empty array is not triggered.
   - A custom rule that throws produces `CUSTOM_RULE_ERROR`.
   - Custom rules receive correct `PolicyContext`.
4. **Verdict computation:**
   - Multiple triggered `fail` rules produce a single `fail` verdict.
   - No triggered rules produce `policy.default`.
   - `default: "fail"` with no triggered rules produces `fail`.
5. **Suppression:**
   - `excludeSuppressed: true` excludes suppressed findings from evaluation.
   - `excludeSuppressed: false` includes suppressed findings.
6. **`createPolicy`:**
   - Partial config is merged with defaults.
   - Missing `failOn` defaults to `DEFAULT_POLICY.failOn`.
   - Missing `default` defaults to `"pass"`.
   - Missing `name` defaults to `"default"`.
   - Invalid severity throws `INVALID_SEVERITY`.
   - Invalid verdict throws `INVALID_VERDICT`.
7. **Determinism:**
   - Identical findings and policy produce identical `PolicyResult` across
     runs.
8. **Summary output:**
   - Summary correctly counts findings by severity.
   - Summary correctly counts triggered rules.
9. **Error cases:**
   - `INVALID_POLICY` for malformed configuration.
   - `CUSTOM_RULE_ERROR` wraps the original error in `cause`.
