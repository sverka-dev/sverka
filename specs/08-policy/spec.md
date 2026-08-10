# Spec 08 — Policy Package: Policy Evaluation

## Overview

The `policy` package evaluates normalized findings against severity-based
policy rules and produces a verdict (`pass` or `fail`). It is the final gate
before the CLI reports results and sets its exit code.

Policies are declarative: a user defines `failOn` rules in a `sverka.config.ts`
file, and the evaluator applies them deterministically to the findings set.

## Goals

1. Evaluate findings against policy rules and produce a pass/fail verdict.
2. Support `failOn` rules that specify which severity levels cause failure.
3. Support `onlyNew` filtering within rules so only newly introduced findings
   cause failure.
4. Support `checkIds` filter to restrict rules to specific checks.
5. Produce a structured verdict with triggering findings and violated rules.
6. Be deterministic: identical findings and policy produce identical verdicts.
7. Support a default policy that requires zero configuration.
8. Export all public types and functions from `src/index.ts`.

## Non-goals (v1)

- Custom TypeScript predicate rules (deferred — non-declarative, speculative).
- `paths` glob filtering on rules (deferred — requires glob-matcher dep).
- Suppression filtering (caller's responsibility — use `filterSuppressed` from
  `@sverka/findings` before passing findings to the evaluator).
- Automatically fixing or suppressing findings.
- Notifications or external integrations on failure.
- Policy versioning or policy-as-code repositories.

## Interfaces

```typescript
import type { Finding, Severity } from "@sverka/findings";

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

/** The default policy used when no policy is configured. */
export const DEFAULT_POLICY: Policy;

/**
 * Create a policy from a partial configuration, filling defaults.
 * @throws {PolicyError} INVALID_SEVERITY if a rule has an unknown severity.
 */
export function createPolicy(config: PolicyConfig): Policy;

/**
 * Evaluate findings against a policy.
 * @param findings Normalized findings (pre-filtered for suppression by caller).
 * @param policy The policy to evaluate.
 * @param baselineFingerprints Fingerprints of baseline findings (for onlyNew).
 *   Pass an empty array when no baseline exists.
 * @returns The evaluation result.
 * @throws {PolicyError} INVALID_POLICY if the policy is malformed.
 */
export function evaluatePolicy(
  findings: readonly Finding[],
  policy: Policy,
  baselineFingerprints: readonly string[],
): PolicyResult;

/** Error thrown for policy configuration and evaluation errors. */
export class PolicyError extends Error {
  readonly code: PolicyErrorCode;
  readonly cause: unknown;
  constructor(message: string, code: PolicyErrorCode, cause?: unknown);
}

/** Policy error codes. */
export type PolicyErrorCode = "INVALID_POLICY" | "INVALID_SEVERITY";
```

## Data models

### Severity ordering

Severities are ordered for threshold comparison:

```
info < low < medium < high < critical
```

A finding triggers a `failOn` rule if `finding.severity >= rule.severity`.

### Default policy

```typescript
{
  name: "default",
  default: "pass",
  failOn: [
    { severity: "high", onlyNew: false },
    { severity: "medium", onlyNew: true }
  ]
}
```

- Any `high` or `critical` finding always fails.
- Any new `medium` or above fails (new = not in baseline).
- `info` and `low` never fail by default.

### Evaluation algorithm

1. **Validate policy:** `failOn` must be an array; each rule's `severity` must
   be a valid `Severity`. Throw `INVALID_POLICY` / `INVALID_SEVERITY` otherwise.
2. **Build baseline set** from `baselineFingerprints` (for `onlyNew` lookup).
3. **Evaluate `failOn` rules** in order. For each rule:
   a. Filter findings by `checkIds` if specified (exact string match).
   b. If `onlyNew`, filter to findings whose `fingerprint` is not in the
      baseline set.
   c. Filter to findings with `severity >= rule.severity`.
   d. If any findings remain, the rule is triggered (verdict `fail`).
4. **Compute final verdict:**
   - If any rule triggered, verdict is `fail`.
   - Otherwise, verdict is `policy.default`.
5. **Assemble `PolicyResult`** with triggered findings, rule results, summary.

### Summary format

```
"fail: 3 findings triggered 2 rules (2 high, 1 medium)"
"pass: no findings triggered any rule"
```

The summary counts triggered findings by severity and lists the number of
triggered rules.

## Error handling

- **`PolicyError`** with `cause: unknown`:
  - `INVALID_POLICY` — `failOn` is missing or not an array.
  - `INVALID_SEVERITY` — a rule specifies an unknown severity.
- **Empty findings are valid.** Empty set with default policy → `pass`.
- **Empty `baselineFingerprints` is valid.** All findings are treated as new.
- No `any` types. `cause` is `unknown`.

## Dependencies

- `@sverka/findings` — imports `Finding` and `Severity` types. This is the
  first wave with an intra-monorepo dependency. The policy package consumes
  the findings types; it does not re-export them.

## Test plan

Tests live in `packages/policy/src/__tests__/` and run via `vitest`.

1. **Default policy:**
   - No findings → `pass`.
   - Only `info` → `pass`.
   - Only `low` → `pass`.
   - `medium` with empty baseline → `fail` (onlyNew: true, all new).
   - `medium` in baseline → `pass` (onlyNew filters it out).
   - `high` → `fail` (always, regardless of baseline).
   - `critical` → `fail`.
2. **`failOn` rules:**
   - `severity: "low"` fails on `low`, `medium`, `high`, `critical`.
   - `severity: "critical"` fails only on `critical`.
   - `onlyNew: true` with baseline excludes baseline findings.
   - `onlyNew: false` includes baseline findings.
   - `checkIds` filter restricts to specified checks.
   - Multiple `failOn` rules evaluated independently.
3. **Verdict computation:**
   - Multiple triggered rules → single `fail`.
   - No triggered rules → `policy.default`.
   - `default: "fail"` with no triggers → `fail`.
4. **`createPolicy`:**
   - Partial config merged with defaults.
   - Missing `failOn` → `DEFAULT_POLICY.failOn`.
   - Missing `default` → `"pass"`.
   - Missing `name` → `"default"`.
   - Invalid severity → `INVALID_SEVERITY`.
5. **Determinism:**
   - Identical findings + policy → identical `PolicyResult` across runs.
6. **Summary output:**
   - Correctly counts findings by severity.
   - Correctly counts triggered rules.
   - `pass` summary when no triggers.
7. **Error cases:**
   - `INVALID_POLICY` when `failOn` is missing/not an array.
   - `INVALID_SEVERITY` for unknown severity string.
8. **Edge cases:**
   - Empty findings array.
   - Empty baseline fingerprints array.
   - Finding with severity exactly at threshold (inclusive).
