# Wave 8 — Policy Implementation Plan

**Architect:** architect-1
**Spec:** `specs/08-policy/spec.md`
**Package:** `@sverka/policy` → `packages/policy`
**Depends on:** `@sverka/findings` (imports `Finding`, `Severity` types only)

This plan is the contract the builder implements against. The spec is the
source of truth; this plan adds sequencing, file layout, conventions, and
edge-case guidance. Where the two disagree, the spec wins.

## 1. Spec amendments applied (architect)

The spec was already trimmed by a prior architect session (sv-fsg). The
following were cut as YAGNI and are NOT in the spec:

- **`PolicyEvaluator` interface** — replaced with a pure function
  `evaluatePolicy(findings, policy, baselineFingerprints)`. No interface
  with one implementation.
- **`CustomRule` + `PolicyContext`** — speculative, non-declarative. Deferred.
- **`FailOnRule.paths` glob** — would require a glob-matcher dep. Deferred.
- **`excludeSuppressed`** — caller's responsibility. Use
  `filterSuppressed` from `@sverka/findings` before passing findings to
  the evaluator.
- **`INVALID_VERDICT` / `CUSTOM_RULE_ERROR` codes** — removed with
  CustomRule. Only 2 codes remain: `INVALID_POLICY`, `INVALID_SEVERITY`.
- **`TriggeredFinding.ruleId` / `RuleResult.ruleId`** — replaced with
  `ruleIndex` (number, index into `policy.failOn`).

One additional amendment for the builder:

1. **`override` on `cause` property.** The spec's `PolicyError` declares
   `readonly cause: unknown;` which overrides `Error.cause` (ES2024 lib).
   The base tsconfig has `noImplicitOverride: true`, so the builder MUST
   add `override` to the `cause` field. (Same issue hit planner + findings
   waves.)

## 2. Scope

Implement severity-based policy evaluation for `@sverka/policy`:

- `evaluatePolicy(findings, policy, baselineFingerprints)` → `PolicyResult`
  (validate, evaluate failOn rules, compute verdict, assemble result).
- `Policy`, `FailOnRule`, `PolicyResult`, `TriggeredFinding`, `RuleResult`,
  `Verdict`, `PolicyConfig` types.
- `DEFAULT_POLICY` constant.
- `createPolicy(config)` → `Policy` (merge with defaults, validate).
- `PolicyError` + `PolicyErrorCode`.
- Severity ordering helper.
- Public re-exports from `src/index.ts`.

**Depends on `@sverka/findings`** for `Finding` and `Severity` types only
(first intra-monorepo dependency). Does NOT re-export them.

**Out of scope (do NOT implement in this wave):**
- Custom TypeScript predicate rules.
- `paths` glob filtering.
- Suppression filtering (caller's job).
- Auto-fixing, notifications, external integrations.
- Policy versioning, policy-as-code repos.
- Loading `sverka.config.ts` (deferred to SDK wave 09).

## 3. Scaffolding status (already present; builder fixes three items)

- `packages/policy/package.json` — **fix 1:** dist paths are `.js`/`.d.ts`;
  must be `.mjs`/`.d.mts`. **fix 2:** add `@sverka/findings` to
  `dependencies` (workspace dep: `"@sverka/findings": "workspace:*"`).
  Run `bun install` after.
- `packages/policy/project.json` — **fix:** lint target uses
  `eslint src --ext .ts`; remove `--ext .ts` (ESLint 9 flat config).
- `tsconfig.json`, `tsdown.config.ts` — already match siblings; no changes.
- `src/index.ts` — placeholder; builder fills exports.

## 4. File layout

Mirror `findings` / `planner` (one module per concern, `__tests__/`
co-located):

```text
packages/policy/src/
  index.ts              # public re-exports (matches spec §Interfaces)
  types.ts              # Policy, FailOnRule, PolicyResult, TriggeredFinding,
                        # RuleResult, Verdict, PolicyConfig (imports Finding, Severity from findings)
  errors.ts             # PolicyError, PolicyErrorCode
  policy.ts             # DEFAULT_POLICY, createPolicy, severity ordering
  evaluator.ts          # evaluatePolicy
  __tests__/
    evaluator.test.ts   # test plan 1-3, 5-8
    policy.test.ts      # test plan 4 (createPolicy, DEFAULT_POLICY)
    public-api.test.ts  # exports match spec §Interfaces
    helpers/
      fixtures.ts       # Finding builders (import from @sverka/findings)
```

## 5. Conventions

- **No `any`.** `cause` is `unknown`. Strict TS.
- **Pure functions.** `evaluatePolicy` and `createPolicy` are pure — no
  I/O, no side effects, no `Date.now()`. Identical input → identical output.
- **Determinism.** Rule evaluation order is deterministic (failOn in
  array order). `triggered` and `rules` arrays preserve evaluation order.
- **Exports.** Only what spec §Interfaces lists is exported from
  `src/index.ts`. `Severity` and `Finding` are imported from
  `@sverka/findings` but NOT re-exported (the spec says "does not re-export
  them").
- **Errors.** `PolicyError` extends `Error`; sets `name`, `code`, `cause`.
  **`cause` MUST have `override` modifier** (noImplicitOverride). Throw,
  don't return, for unrecoverable codes.
- **Severity ordering.** `info < low < medium < high < critical`. Implement
  as a rank map: `{ info: 0, low: 1, medium: 2, high: 3, critical: 4 }`.
  A finding triggers a failOn rule if `rank(finding.severity) >=
  rank(rule.severity)`.

## 6. Implementation steps (builder, TDD — tests first)

1. **Fix scaffolding.** Edit `package.json`: dist paths → `.mjs`/`.d.mts`,
   add `@sverka/findings: workspace:*` to `dependencies`.
   Edit `project.json` lint → `eslint src`. `bun install`.
2. **`types.ts`.** Pure type definitions — `Verdict`, `Policy`,
   `FailOnRule`, `TriggeredFinding`, `RuleResult`, `PolicyResult`,
   `PolicyConfig`. Import `Finding` and `Severity` from `@sverka/findings`
   (type-only import). No tests needed (types only).
3. **`errors.ts` + tests.** `PolicyError` + `PolicyErrorCode` union (2
   codes: `INVALID_POLICY`, `INVALID_SEVERITY`). **`override` on
   `cause`.** Test construction, name, code, cause chaining.
4. **`policy.ts` + `policy.test.ts` (TDD).**
   - `SEVERITY_RANK` map + `severityRank(s)` helper.
   - `DEFAULT_POLICY` (frozen): name "default", default "pass", failOn
     `[{ severity: "high", onlyNew: false }, { severity: "medium",
     onlyNew: true }]`.
   - `createPolicy(config)`: merge config with defaults. Validate
     failOn severities → `INVALID_SEVERITY`. Validate failOn is array →
     `INVALID_POLICY`. Fill missing fields from defaults.
   - Write failing tests first (test plan 4), then implement.
5. **`evaluator.ts` + `evaluator.test.ts` (TDD).**
   - `evaluatePolicy(findings, policy, baselineFingerprints)`:
     a. Validate policy: `failOn` must be array, each severity valid.
        Throw `INVALID_POLICY` / `INVALID_SEVERITY`.
     b. Build baseline `Set<string>` from `baselineFingerprints`.
     c. For each `failOn` rule (in order):
        - Filter by `checkIds` if specified (exact match on `finding.checkId`).
        - If `onlyNew`: filter to findings whose `fingerprint` NOT in
          baseline set.
        - Filter to `severityRank(finding.severity) >=
          severityRank(rule.severity)`.
        - If any remain: rule triggered. Record `RuleResult` +
          `TriggeredFinding` per finding.
     d. Compute final verdict: "fail" if any rule triggered, else
        `policy.default`.
     e. Build summary: `"fail: N findings triggered M rules (X high, Y
        medium, ...)"` or `"pass: no findings triggered any rule"`.
   - Write failing tests first (test plan 1-3, 5-8), then implement.
6. **`__tests__/helpers/fixtures.ts`.** Finding builders using
   `@sverka/findings` types. Keep minimal — inline Finding objects in
   tests are fine for simple cases.
7. **`public-api.test.ts`.** Assert `src/index.ts` exports exactly the
   spec list (types + functions + error class + DEFAULT_POLICY).
8. **Gates.** `bun run test` (policy), `bun run typecheck`,
   `bun run lint`, `bun run build` for policy; then full monorepo
   `bun run test/typecheck/lint/build` (16 projects) to catch
   entangled breakage.

## 7. Edge cases

- **Empty findings.** Valid → verdict is `policy.default` (usually
  "pass"). No rules triggered. Summary: "pass: no findings triggered
  any rule".
- **Empty `baselineFingerprints`.** All findings are "new" — `onlyNew`
  rules apply to all matching findings.
- **Finding with severity exactly at threshold.** Inclusive — triggers
  the rule (`>=` comparison).
- **Multiple failOn rules match the same finding.** The finding appears
  in multiple RuleResults and TriggeredFindings (one per matching rule).
- **`checkIds` filter with no matches.** Rule evaluates zero findings →
  not triggered.
- **`default: "fail"` with no triggered rules.** Verdict is "fail".
  Summary: "fail: no findings triggered any rule" (or similar).
- **Invalid severity in failOn (hand-constructed Policy).** `evaluatePolicy`
  validates and throws `INVALID_SEVERITY` at evaluation time.
- **`failOn` is not an array.** `evaluatePolicy` throws `INVALID_POLICY`.

## 8. Test plan → spec mapping

| Spec test plan | File | Notes |
|---|---|---|
| 1 default policy | `evaluator.test.ts` | no/low/medium/high/critical, baseline interactions |
| 2 failOn rules | `evaluator.test.ts` | severity thresholds, onlyNew, checkIds, multiple rules |
| 3 verdict computation | `evaluator.test.ts` | multiple fail → single fail, no trigger → default, default=fail |
| 4 createPolicy | `policy.test.ts` | merge defaults, invalid severity |
| 5 determinism | `evaluator.test.ts` | identical input → identical result |
| 6 summary output | `evaluator.test.ts` | counts by severity, rule count, pass summary |
| 7 error cases | `evaluator.test.ts` + `policy.test.ts` | INVALID_POLICY, INVALID_SEVERITY |
| 8 edge cases | `evaluator.test.ts` | empty findings, empty baseline, threshold boundary |

## 9. Acceptance

- All policy tests pass (`bun run test` for policy).
- Full monorepo green: test, typecheck, lint, build across 16 projects.
- `src/index.ts` exports match spec §Interfaces exactly; no `any`.
- `override` on `cause` in `PolicyError` (noImplicitOverride).
- `evaluatePolicy` is deterministic for identical input.
- `@sverka/findings` workspace dependency added (types only).
- `DEFAULT_POLICY` is frozen (immutable).
- No `minimatch` or other new external dependencies.
