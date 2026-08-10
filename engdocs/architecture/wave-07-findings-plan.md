# Wave 7 — Findings Implementation Plan

**Architect:** architect-1
**Spec:** `specs/07-findings/spec.md`
**Package:** `@sverka/findings` → `packages/findings`
**Depends on:** none (standalone — uses only Node stdlib `node:crypto`,
`node:fs`, `node:path`)

This plan is the contract the builder implements against. The spec is the
source of truth; this plan adds sequencing, file layout, conventions, and
edge-case guidance. Where the two disagree, the spec wins.

## 1. Spec amendments applied (architect)

The spec is already well-trimmed. One amendment is needed:

1. **`override` on `cause` property.** The spec's error classes declare
   `readonly cause: unknown;` which overrides `Error.cause` (ES2024 lib).
   The base tsconfig has `noImplicitOverride: true`, so the builder MUST
   add `override` to the `cause` field in both `NormalizationError` and
   `BaselineError`. This is a TypeScript syntax fix, not a design change.
   (Same issue hit the planner wave — see drill-finding / planner fix.)

No other amendments. The spec already cuts: pluggable normalizer registry,
non-SARIF normalizers, inline suppressions, cross-tool dedup, auto-fix,
dashboard, SARIF taxonomies, `Finding.tags`, confidence normalization.

## 2. Scope

Implement SARIF normalization, fingerprinting, baseline management, and
suppression filtering for `@sverka/findings`:

- `normalizeSarif(sarif, context)` → `Finding[]` (validate, map levels,
  resolve rules, multi-location expansion, fingerprint, id assignment).
- `computeFingerprint(input)` → lowercase hex SHA-256 string.
- `createBaseline`, `updateBaseline`, `compareBaseline`, `loadBaseline`,
  `saveBaseline` — baseline CRUD + diff.
- `isSuppressed`, `filterSuppressed`, `filterOnlyNew` — suppression logic.
- `NormalizationError` + `BaselineError` with codes.
- Public re-exports from `src/index.ts`.

**No workspace dependencies.** Uses only Node stdlib (`node:crypto`,
`node:fs`, `node:path`).

**Out of scope (do NOT implement in this wave):**
- Non-SARIF normalizers (ESLint JSON, Semgrep JSON, text).
- Pluggable normalizer registry / `FindingNormalizer` interface.
- Inline source-code suppressions (`// sverka-ignore-next-line`).
- Cross-tool deduplication.
- Auto-fix, dashboard, findings database.
- SARIF extensions/taxonomies beyond basic normalization.
- `Finding.tags` (deferred — no v1 consumer).

## 3. Scaffolding status (already present; builder fixes two items)

- `packages/findings/package.json` — **fix:** dist paths are `.js`/`.d.ts`;
  must be `.mjs`/`.d.mts` to match `core`/`ir`/`runtime`/`planner`.
  No `dependencies` needed (standalone). `devDependencies` already present.
- `packages/findings/project.json` — **fix:** lint target uses
  `eslint src --ext .ts`; remove `--ext .ts` (ESLint 9 flat config, per
  sv-ei2 / drill-finding). Test target already has `--passWithNoTests`.
- `tsconfig.json`, `tsdown.config.ts` — already match siblings; no changes.
- `src/index.ts` — placeholder; builder fills exports.
- Run `bun install` after `package.json` edit.

## 4. File layout

Mirror `planner` / `runtime-host` (one module per concern, `__tests__/`
co-located):

```
packages/findings/src/
  index.ts              # public re-exports (matches spec §Interfaces)
  types.ts              # Finding, Severity, FindingSource, NormalizeContext, FingerprintInput
  errors.ts             # NormalizationError, NormalizationErrorCode, BaselineError, BaselineErrorCode
  normalize.ts          # SarifLog + sub-types, normalizeSarif
  fingerprint.ts        # computeFingerprint
  baseline.ts           # Baseline, Suppression, BaselineDiff, create/update/compare/load/save
  suppress.ts           # isSuppressed, filterSuppressed, filterOnlyNew
  __tests__/
    normalize.test.ts   # test plan 1, 9 (normalization errors), 10 (determinism)
    fingerprint.test.ts # test plan 2
    baseline.test.ts    # test plan 3, 4, 5, 8
    suppress.test.ts    # test plan 6, 7
    public-api.test.ts  # exports match spec §Interfaces
    helpers/
      fixtures.ts       # SARIF sample builders, temp baseline files
```

## 5. Conventions

- **No `any`.** `cause` is `unknown`; SARIF input is typed via `SarifLog`
  but validated at runtime (types are erased). Strict TS.
- **Pure/impure split.** `types.ts`, `fingerprint.ts`, `normalize.ts`
  (pure), `suppress.ts` (pure), `baseline.ts` create/update/compare (pure).
  Only `loadBaseline`/`saveBaseline` do I/O (`node:fs`). No mockable seam
  needed — I/O is isolated to two functions, testable via temp files.
- **Determinism.** Fingerprints are SHA-256 — deterministic by construction.
  `normalizeSarif` output is deterministic for identical input + context.
  No `Date.now()` in normalization or fingerprinting. **Baseline
  timestamps** (`createdAt`/`updatedAt`) use `new Date().toISOString()`
  — these are NOT part of fingerprinting and do not affect determinism
  of findings. Baseline tests that check timestamps validate ISO 8601
  format, not exact values.
- **Exports.** Only what spec §Interfaces lists is exported from
  `src/index.ts`. No internal helpers exported.
- **Errors.** Both error classes extend `Error`; set `name`, `code`,
  `cause`. **`cause` MUST have `override` modifier** (noImplicitOverride).
  Throw, don't return, for unrecoverable codes.
- **SARIF validation.** Runtime validation of the parsed SARIF structure.
  Check: `version === "2.1.0"`, `runs` is an array, each run has
  `tool.driver.name`, `results` is an array. Throw `INVALID_SARIF` with
  a descriptive message + cause on failure. Do NOT use a JSON schema
  library — hand-rolled checks are sufficient (YAGNI).

## 6. Implementation steps (builder, TDD — tests first)

1. **Fix scaffolding.** Edit `package.json` dist paths → `.mjs`/`.d.mts`.
   Edit `project.json` lint → `eslint src`. `bun install`.
2. **`types.ts`.** Pure type definitions — `Finding`, `Severity`,
   `FindingSource`, `NormalizeContext`, `FingerprintInput`. No tests
   needed (types only); verified by compile + public-api test.
3. **`errors.ts` + `errors.test.ts` (or fold into relevant test files).**
   `NormalizationError` + `NormalizationErrorCode` (3 codes),
   `BaselineError` + `BaselineErrorCode` (3 codes). **`override` on
   `cause`.** Test construction, name, code, cause chaining for both.
4. **`fingerprint.ts` + `fingerprint.test.ts` (TDD).** Pure function:
   `computeFingerprint(input)` → `sha256("{checkId}|{rule}|{normalizedFile}|{startLine}|{endLine}")`.
   Normalize backslashes → forward slashes in `file`. Validate non-empty
   required fields → `INVALID_FINGERPRINT_INPUT`. Lowercase hex, 64 chars.
   Write failing tests first (test plan 2), then implement.
5. **`normalize.ts` + `normalize.test.ts` (TDD).**
   - Define `SarifLog`, `SarifRun`, `SarifRule`, `SarifResult`,
     `SarifLocation` interfaces.
   - `normalizeSarif(sarif, context)`:
     - Validate structure → `INVALID_SARIF`.
     - For each run: extract tool name/version, build rule map
       (`tool.driver.rules` indexed by `ruleId` and `ruleIndex`).
     - For each result: resolve rule (by `ruleId` or `ruleIndex`),
       map level → severity (table below), extract message, expand
       locations (one finding per location; no locations →
       `MISSING_LOCATION`), build `FindingSource`, construct `checkId`
       (`{prefix}:{ruleId}` or `ruleId`), compute fingerprint, assign
       `id = {checkId}:{fingerprint}`.
   - SARIF level → severity: `error`→`high`, `warning`→`medium`,
     `note`→`low`, `none`→`info`, absent→`info`. Rule
     `defaultConfiguration.level` used when result has no `level`.
   - Write failing tests first (test plan 1, 9, 10), then implement.
6. **`baseline.ts` + `baseline.test.ts` (TDD).**
   - `createBaseline(findings)`: version 1, all fingerprints (deduped),
     no suppressions, `createdAt`=`updatedAt`=`new Date().toISOString()`.
   - `updateBaseline(current, existing)`: merge current fingerprints,
     remove resolved ones, remove suppressions for resolved fingerprints,
     preserve `createdAt`, refresh `updatedAt`.
   - `compareBaseline(current, baseline)`: `newFindings` (fingerprint not
     in baseline), `resolvedFingerprints` (baseline fingerprint not in
     current), `unchangedFindings` (in both).
   - `loadBaseline(path)`: read JSON, validate `version === 1`,
     `fingerprints` is array, `suppressions` is array. Throw
     `BASELINE_NOT_FOUND` (ENOENT), `BASELINE_INVALID` (bad JSON / wrong
     schema).
   - `saveBaseline(baseline, path)`: `JSON.stringify` with 2-space indent,
     write to file. Throw `BASELINE_WRITE_FAILED` on write error.
   - Write failing tests first (test plan 3, 4, 5, 8), then implement.
7. **`suppress.ts` + `suppress.test.ts` (TDD).**
   - `isSuppressed(finding, baseline)`: true if fingerprint matches a
     suppression with `expiresAt` absent or in the future.
   - `filterSuppressed(findings, baseline, includeSuppressed)`: when
     `includeSuppressed` is true, return all; when false, exclude
     suppressed.
   - `filterOnlyNew(findings, baseline)`: findings whose fingerprint is
     NOT in `baseline.fingerprints` AND not suppressed.
   - Write failing tests first (test plan 6, 7), then implement.
8. **`__tests__/helpers/fixtures.ts`.** SARIF sample builders (minimal
   valid log, multi-result, multi-location, invalid variants) and temp
   baseline file helpers. Keep minimal — inline SARIF objects in tests
   are fine for simple cases; use fixtures for repeated patterns.
9. **`public-api.test.ts`.** Assert `src/index.ts` exports exactly the
   spec list (types + functions + error classes).
10. **Gates.** `bun run test` (findings), `bun run typecheck`,
    `bun run lint`, `bun run build` for findings; then full monorepo
    `bun run test/typecheck/lint/build` (16 projects) to catch
    entangled breakage.

## 7. Edge cases

- **SARIF result with no `ruleId` and no `ruleIndex`.** `ruleId` defaults
  to `""` (empty string). `checkId` becomes `{prefix}:` or just `""`.
  The finding is still valid; fingerprint uses empty `rule`.
- **SARIF result with `ruleIndex` but no `rules` array.** Cannot resolve
  rule → `ruleId` = `""`, `helpUrl` = undefined, `originalSeverity`
  from result level only.
- **Multi-location result.** One `Finding` per location. Each gets its
  own fingerprint (different `file`/`startLine`).
- **Empty `runs` array.** Valid SARIF → `normalizeSarif` returns `[]`.
- **Empty `results` array.** Valid → returns `[]`.
- **Baseline with duplicate fingerprints.** `createBaseline` dedupes
  (store as sorted unique array). `compareBaseline` uses set membership.
- **Suppression with `expiresAt` exactly now.** Treat as expired
  (use `<` not `<=` comparison against current time, or compare
  `expiresAt <= now` → expired). Document the boundary in a comment.
- **Baseline file with extra unknown fields.** Accept (forward-compat);
  only validate required fields (`version`, `fingerprints`, `suppressions`).
- **`saveBaseline` to a non-existent directory.** `BASELINE_WRITE_FAILED`
  (do not auto-create directories — caller's responsibility).
- **`loadBaseline` with wrong `version`.** `BASELINE_INVALID`.

## 8. Test plan → spec mapping

| Spec test plan | File | Notes |
|---|---|---|
| 1 SARIF normalization | `normalize.test.ts` | levels, rules, ruleIndex, multi-location, checkId, id |
| 2 fingerprint | `fingerprint.test.ts` | determinism, discrimination, backslash, empty fields, hex format |
| 3 baseline create | `baseline.test.ts` | fingerprints, timestamps, version, no suppressions |
| 4 baseline update | `baseline.test.ts` | add new, remove resolved, remove stale suppressions, preserve createdAt |
| 5 baseline compare | `baseline.test.ts` | new/resolved/unchanged, empty current, empty baseline |
| 6 suppression | `suppress.test.ts` | filterSuppressed true/false, expired, isSuppressed |
| 7 only-new filtering | `suppress.test.ts` | filterOnlyNew excludes baseline + suppressed |
| 8 baseline I/O | `baseline.test.ts` | load/save, not found, invalid JSON, wrong version, write failed |
| 9 error cases (norm) | `normalize.test.ts` | INVALID_SARIF, MISSING_LOCATION, INVALID_FINGERPRINT_INPUT |
| 10 determinism | `normalize.test.ts` | identical SARIF + context → identical Finding[] |

## 9. Acceptance

- All findings tests pass (`bun run test` for findings).
- Full monorepo green: test, typecheck, lint, build across 16 projects.
- `src/index.ts` exports match spec §Interfaces exactly; no `any`.
- `override` on `cause` in both error classes (noImplicitOverride).
- Fingerprint is deterministic SHA-256 lowercase hex (64 chars).
- `normalizeSarif` is deterministic for identical input + context.
- No workspace dependencies added (findings standalone).
