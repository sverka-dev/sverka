# Spec 07 — Findings Package: Normalization, Fingerprints, Baseline

## Overview

The `findings` package normalizes output from heterogeneous analysis tools into
a single canonical `Finding` model. It computes stable fingerprints so findings
can be tracked across runs, maintains a baseline of known findings, supports
suppression of false positives via the baseline file, and provides only-new
filtering so repeated runs report newly introduced issues.

Every finding — whether from SARIF-emitting tools (CodeQL, ESLint, Semgrep,
SonarCloud) or a custom check — is normalized to the same shape before it
reaches policy evaluation or the CLI output layer.

## Goals

1. Normalize SARIF 2.1.0 output into the canonical `Finding` model (SARIF is
   the interchange format; most tools emit it).
2. Compute deterministic fingerprints that are stable across runs and
   insensitive to cosmetic changes (whitespace, message wording).
3. Maintain a baseline file of known findings that can be created, updated, and
   compared.
4. Support suppression of findings via baseline entries (by fingerprint).
5. Provide only-new filtering that returns findings not present in the
   baseline.
6. Preserve the original tool source on every finding for traceability.
7. Support severity normalization across tools that use different scales.
8. Be fully deterministic: identical tool output produces identical normalized
   findings and fingerprints.
9. Export all public types and functions from `src/index.ts`.

## Non-goals (v1 / Wave 7)

- Re-implementing static analysis tools.
- A pluggable normalizer registry or `FindingNormalizer` interface. v1
  implements SARIF normalization only. The interface is extracted when a
  second normalizer arrives (YAGNI).
- Non-SARIF normalizers (raw ESLint JSON, Semgrep JSON, text output). Deferred
  until a concrete consumer needs a format SARIF cannot cover.
- Inline source-code suppressions (`// sverka-ignore-next-line`). Deferred to a
  follow-up; baseline suppressions by fingerprint cover the v1 use case.
- Deduplicating findings across tools that report the same issue (future work).
- Automatically fixing findings.
- Hosting a findings database or dashboard.
- Supporting SARIF extensions and taxonomies beyond what is needed for
  normalization. `Finding.tags` is deferred (no v1 consumer).
- Confidence normalization across tools. v1 defaults confidence to
  `defaultConfidence` (SARIF has no standard confidence field).

## Interfaces

```typescript
// src/index.ts — public exports

export { type Finding, type Severity, type FindingSource,
         type NormalizeContext, type FingerprintInput } from "./types.js";
export { type Baseline, type Suppression, type BaselineDiff } from "./baseline.js";
export { type SarifLog, type SarifRun, type SarifRule,
         type SarifResult, type SarifLocation } from "./normalize.js";
export { normalizeSarif } from "./normalize.js";
export { computeFingerprint } from "./fingerprint.js";
export { createBaseline, updateBaseline, compareBaseline,
         loadBaseline, saveBaseline } from "./baseline.js";
export { isSuppressed, filterSuppressed, filterOnlyNew } from "./suppress.js";
export { NormalizationError, type NormalizationErrorCode,
         BaselineError, type BaselineErrorCode } from "./errors.js";
```

```typescript
// src/types.ts

/**
 * A normalized finding from any analysis tool.
 */
export interface Finding {
  /** Stable unique identifier: `{checkId}:{fingerprint}`. */
  id: string;
  /** Deterministic fingerprint used for baseline tracking. */
  fingerprint: string;
  /** Identifier of the check that produced this finding. */
  checkId: string;
  /** Severity level. */
  severity: Severity;
  /** Confidence level (0.0–1.0). Defaults to 0.5 for SARIF. */
  confidence: number;
  /** Human-readable message describing the finding. */
  message: string;
  /** Rule identifier from the originating tool. */
  rule: string;
  /** File path relative to project root, forward slashes. */
  file: string;
  /** Start line (1-based). */
  startLine: number;
  /** End line (1-based, inclusive). */
  endLine: number;
  /** Optional start column (1-based). */
  startColumn?: number;
  /** Optional end column (1-based). */
  endColumn?: number;
  /** Optional URL to documentation or remediation help. */
  helpUrl?: string;
  /** Source tool that produced the finding. */
  source: FindingSource;
  /** Optional code snippet surrounding the finding. */
  snippet?: string;
}

/**
 * Severity levels ordered from least to most severe.
 */
export type Severity = "info" | "low" | "medium" | "high" | "critical";

/**
 * The source tool that produced a finding.
 */
export interface FindingSource {
  /** Tool name (e.g. "eslint", "semgrep", "sonarcloud"). */
  tool: string;
  /** Tool version if known. */
  version: string | null;
  /** Original format of the tool output. */
  format: "sarif" | "json" | "text" | "custom";
  /** Original rule ID from the tool before normalization. */
  originalRuleId: string;
  /** Original severity from the tool before normalization. */
  originalSeverity: string | null;
}

/**
 * Context passed to the normalizer.
 */
export interface NormalizeContext {
  /** Project root for resolving relative paths. */
  root: string;
  /** Prefix for constructing checkId: `{checkIdPrefix}:{ruleId}` (or just
   *  `ruleId` when prefix is empty). */
  checkIdPrefix: string;
  /** Default confidence when the tool does not provide one (default 0.5). */
  defaultConfidence: number;
}

/**
 * Input to fingerprint computation.
 * `rule` and `checkId` may be empty (SARIF results without rule ids).
 * `file` must be non-empty; `startLine`/`endLine` must be positive.
 */
export interface FingerprintInput {
  rule: string;
  file: string;
  startLine: number;
  endLine: number;
  checkId: string;
}
```

```typescript
// src/normalize.ts

/**
 * Minimal SARIF 2.1.0 log structure (subset required for normalization).
 */
export interface SarifLog {
  version: "2.1.0";
  runs: SarifRun[];
}

export interface SarifRun {
  tool: {
    driver: {
      name: string;
      version?: string;
      rules?: SarifRule[];
    };
  };
  results: SarifResult[];
}

export interface SarifRule {
  id: string;
  name?: string;
  shortDescription?: { text: string };
  helpUri?: string;
  defaultConfiguration?: { level?: string };
}

export interface SarifResult {
  /** Rule ID. May be absent when `ruleIndex` is provided instead. */
  ruleId?: string;
  /** Index into `tool.driver.rules`. Used when `ruleId` is absent. */
  ruleIndex?: number;
  level?: "none" | "note" | "warning" | "error";
  message: { text: string };
  locations: SarifLocation[];
  partialFingerprints?: Record<string, string>;
  fingerprints?: Record<string, string>;
}

export interface SarifLocation {
  physicalLocation: {
    artifactLocation: { uri: string; uriBaseId?: string };
    region?: {
      startLine: number;
      endLine?: number;
      startColumn?: number;
      endColumn?: number;
      snippet?: { text: string };
    };
  };
}

/**
 * Normalize a parsed SARIF 2.1.0 log into Findings.
 *
 * Validates the SARIF structure at runtime (TypeScript types are erased).
 * Computes fingerprints and assigns ids (`{checkId}:{fingerprint}`).
 * Multi-location results produce one finding per location.
 *
 * @throws {NormalizationError} INVALID_SARIF — structure does not conform.
 * @throws {NormalizationError} MISSING_LOCATION — a result has no location.
 */
export function normalizeSarif(
  sarif: SarifLog,
  context: NormalizeContext,
): Finding[];
```

```typescript
// src/fingerprint.ts

/**
 * Compute a deterministic fingerprint for the given finding data.
 *
 * The fingerprint is insensitive to message wording and severity changes,
 * but sensitive to file, rule, and line range. It is a lowercase hex
 * SHA-256 string.
 *
 * @throws {NormalizationError} INVALID_FINGERPRINT_INPUT — `file` is empty,
 *   or `startLine`/`endLine` are not positive integers. `rule` and `checkId`
 *   may be empty (SARIF results without rule identifiers are valid).
 */
export function computeFingerprint(input: FingerprintInput): string;
```

```typescript
// src/baseline.ts

/**
 * A baseline of known findings.
 */
export interface Baseline {
  /** Schema version of the baseline file. */
  version: number;
  /** Fingerprints of known findings. */
  fingerprints: string[];
  /** Suppression entries. */
  suppressions: Suppression[];
  /** When the baseline was created (ISO 8601). */
  createdAt: string;
  /** When the baseline was last updated (ISO 8601). */
  updatedAt: string;
}

/**
 * A suppression entry that marks a finding as ignored.
 */
export interface Suppression {
  /** Fingerprint of the suppressed finding. */
  fingerprint: string;
  /** Reason for suppression. */
  reason: string;
  /** Who created the suppression. */
  author: string;
  /** When the suppression was created (ISO 8601). */
  createdAt: string;
  /** Optional expiry date (ISO 8601). Expired suppressions are skipped. */
  expiresAt?: string;
}

/**
 * Result of comparing findings against a baseline.
 */
export interface BaselineDiff {
  /** Findings not present in the baseline (new). */
  newFindings: Finding[];
  /** Fingerprints in the baseline but not in the current run (resolved).
   *  Only fingerprints — the baseline does not store full Finding objects. */
  resolvedFingerprints: string[];
  /** Findings present in both (unchanged). */
  unchangedFindings: Finding[];
}

/**
 * Create a new baseline from a set of findings.
 * All fingerprints are added. No suppressions.
 * Timestamps are set to the current time.
 */
export function createBaseline(findings: readonly Finding[]): Baseline;

/**
 * Merge current findings into an existing baseline.
 * New fingerprints are added. Fingerprints no longer present are removed.
 * Suppressions for removed fingerprints are removed.
 * `updatedAt` is refreshed.
 */
export function updateBaseline(
  current: readonly Finding[],
  existing: Baseline,
): Baseline;

/**
 * Compare current findings against a baseline.
 * A finding is "new" if its fingerprint is not in `baseline.fingerprints`.
 * A fingerprint is "resolved" if it is in the baseline but not in current.
 * Otherwise the finding is "unchanged".
 */
export function compareBaseline(
  current: readonly Finding[],
  baseline: Baseline,
): BaselineDiff;

/**
 * Load a baseline from a JSON file.
 * @throws {BaselineError} BASELINE_NOT_FOUND — file does not exist.
 * @throws {BaselineError} BASELINE_INVALID — invalid JSON or wrong schema.
 */
export function loadBaseline(path: string): Promise<Baseline>;

/**
 * Save a baseline to a JSON file.
 * @throws {BaselineError} BASELINE_WRITE_FAILED — cannot write the file.
 */
export function saveBaseline(baseline: Baseline, path: string): Promise<void>;
```

```typescript
// src/suppress.ts

/**
 * Check if a finding is suppressed by the baseline.
 * A finding is suppressed if its fingerprint matches a suppression entry
 * that has not expired (`expiresAt` is in the future or absent).
 */
export function isSuppressed(finding: Finding, baseline: Baseline): boolean;

/**
 * Filter out suppressed findings.
 * @param includeSuppressed When true, all findings are returned unchanged.
 */
export function filterSuppressed(
  findings: readonly Finding[],
  baseline: Baseline,
  includeSuppressed: boolean,
): Finding[];

/**
 * Return only findings not present in the baseline (new findings).
 * Suppressed findings are excluded.
 */
export function filterOnlyNew(
  findings: readonly Finding[],
  baseline: Baseline,
): Finding[];
```

```typescript
// src/errors.ts

export class NormalizationError extends Error {
  readonly code: NormalizationErrorCode;
  readonly cause: unknown;
  constructor(message: string, code: NormalizationErrorCode, cause?: unknown) {
    super(message);
    this.name = "NormalizationError";
    this.code = code;
    this.cause = cause;
  }
}

export type NormalizationErrorCode =
  | "INVALID_SARIF"
  | "MISSING_LOCATION"
  | "INVALID_FINGERPRINT_INPUT";

export class BaselineError extends Error {
  readonly code: BaselineErrorCode;
  readonly cause: unknown;
  constructor(message: string, code: BaselineErrorCode, cause?: unknown) {
    super(message);
    this.name = "BaselineError";
    this.code = code;
    this.cause = cause;
  }
}

export type BaselineErrorCode =
  | "BASELINE_NOT_FOUND"
  | "BASELINE_INVALID"
  | "BASELINE_WRITE_FAILED";
```

## Data models

### Finding normalization pipeline

1. **Parsed SARIF is received** as a `SarifLog` object (the caller handles
   `JSON.parse`).
2. **`normalizeSarif` validates the structure** at runtime and throws
   `INVALID_SARIF` if it does not conform.
3. **Each result produces one finding per location.** Missing locations throw
   `MISSING_LOCATION`.
4. **Fields are populated** with defaults for missing values:
   - `severity`: `"info"` when the result has no level.
   - `confidence`: `defaultConfidence` from `NormalizeContext` (default 0.5).
   - `helpUrl`: `undefined` when the rule has no `helpUri`.
5. **`checkId` is constructed**: `{checkIdPrefix}:{ruleId}` when prefix is
   non-empty, else `ruleId`.
6. **Fingerprints are computed** via `computeFingerprint` using `rule`, `file`,
   `startLine`, `endLine`, and `checkId`.
7. **IDs are assigned** as `{checkId}:{fingerprint}`.

### SARIF level-to-severity mapping

| SARIF level | Sverka severity |
|---|---|
| `error` | `high` |
| `warning` | `medium` |
| `note` | `low` |
| `none` | `info` |
| (absent) | `info` |

If a SARIF rule has `defaultConfiguration.level`, that level is used when the
result does not specify its own `level`.

Rule metadata (`helpUri`, `shortDescription`) is extracted from the run's
`tool.driver.rules` array. The rule is resolved by `ruleId` when present, or
by `ruleIndex` into the `rules` array when `ruleId` is absent. When neither
is available, `ruleId` defaults to `""` (empty string). Empty `rule` and
`checkId` are valid fingerprint inputs — the fingerprint is location-only.

### Fingerprint computation

```
sha256("{checkId}|{rule}|{normalizedFile}|{startLine}|{endLine}")
```

- `normalizedFile` is the file path with `\\` replaced by `/`. The caller
  (`normalizeSarif`) is responsible for making the path relative to the
  project root before passing it to `computeFingerprint`. `FingerprintInput`
  has no `root` field — `computeFingerprint` only normalizes backslashes.
- Excludes `message` (reworded messages do not create new findings).
- Excludes `severity` (severity changes do not create new findings).
- Lowercase hex string.

### Baseline file format

JSON file (default: `.sverka/baseline.json`):

```json
{
  "version": 1,
  "fingerprints": ["abc123...", "def456..."],
  "suppressions": [
    {
      "fingerprint": "abc123...",
      "reason": "False positive in generated code",
      "author": "jane@example.com",
      "createdAt": "2025-01-15T10:00:00Z",
      "expiresAt": "2025-07-15T10:00:00Z"
    }
  ],
  "createdAt": "2025-01-15T10:00:00Z",
  "updatedAt": "2025-01-20T14:30:00Z"
}
```

### Baseline operations

- **Create:** `createBaseline(findings)` → `Baseline` with all fingerprints,
  no suppressions, current timestamps. Caller persists via `saveBaseline`.
- **Update:** `updateBaseline(current, existing)` → new `Baseline` with
  current fingerprints merged, resolved fingerprints removed, suppressions
  for resolved fingerprints removed, `updatedAt` refreshed.
- **Compare:** `compareBaseline(current, baseline)` → `BaselineDiff` with
  `newFindings`, `resolvedFingerprints`, `unchangedFindings`.

### Suppression

Suppressions are matched by fingerprint. A finding is suppressed if:

1. Its fingerprint matches a suppression entry, AND
2. The suppression has not expired (`expiresAt` is in the future or absent).

Suppressed findings are excluded from `filterOnlyNew` results by default.
`filterSuppressed(findings, baseline, true)` includes them.

### Only-new filtering

`filterOnlyNew(findings, baseline)` returns findings whose fingerprints are
not in `baseline.fingerprints` and are not suppressed. The caller handles a
missing baseline file (catch `BASELINE_NOT_FOUND` from `loadBaseline` and
treat all findings as new if desired).

## Error handling

- **`NormalizationError`** codes:
  - `INVALID_SARIF` — SARIF does not conform to 2.1.0 structure.
  - `MISSING_LOCATION` — a SARIF result has no location.
  - `INVALID_FINGERPRINT_INPUT` — `file` is empty or `startLine`/`endLine`
    are not positive integers. `rule` and `checkId` may be empty.
- **`BaselineError`** codes:
  - `BASELINE_NOT_FOUND` — baseline file does not exist.
  - `BASELINE_INVALID` — baseline file is not valid JSON or wrong schema
    version.
  - `BASELINE_WRITE_FAILED` — baseline file could not be written.
- Fingerprint computation throws `NormalizationError` with code
  `INVALID_FINGERPRINT_INPUT` when `file` is empty or `startLine`/`endLine`
  are not positive integers. Empty `rule`/`checkId` are valid (SARIF edge
  case). Never throws for valid input.
- All errors include a `cause` field typed as `unknown`.
- No `any` types are used.

## Test plan

Tests live in `packages/findings/src/__tests__/` and run via `bun run test`
(vitest via nx).

1. **SARIF normalization:**
   - A minimal SARIF log with one result produces one `Finding`.
   - SARIF levels map to correct severities (`error`→`high`, `warning`→
     `medium`, `note`→`low`, `none`→`info`, absent→`info`).
   - Rule `defaultConfiguration.level` is used when result has no level.
   - Rule metadata (`helpUri`) is extracted from `tool.driver.rules`.
   - `ruleIndex` is used when `ruleId` is absent.
   - Multi-location results produce one finding per location.
   - Results without locations throw `MISSING_LOCATION`.
   - Invalid SARIF (wrong version, missing `runs`) throws `INVALID_SARIF`.
   - `checkId` is `{prefix}:{ruleId}` when prefix is non-empty, else `ruleId`.
   - `id` is `{checkId}:{fingerprint}`.
   - `source.tool` and `source.originalSeverity` are set correctly.
2. **Fingerprint computation:**
   - Identical inputs produce identical fingerprints.
   - Different `rule`/`file`/line-range/`checkId` values produce different
     fingerprints.
   - Message and severity changes do not affect the fingerprint.
   - Windows backslash paths are normalized to forward slashes.
   - Empty `file` or non-positive `startLine`/`endLine` throw
     `INVALID_FINGERPRINT_INPUT`; empty `rule`/`checkId` are valid.
   - Output is lowercase hex SHA-256 (64 chars).
3. **Baseline create:**
   - `createBaseline(findings)` returns a `Baseline` with all fingerprints.
   - `createdAt` and `updatedAt` are valid ISO 8601 strings.
   - `version` is 1. No suppressions.
4. **Baseline update:**
   - New fingerprints are added.
   - Resolved fingerprints are removed.
   - Suppressions for resolved fingerprints are removed.
   - `updatedAt` is refreshed; `createdAt` is preserved.
5. **Baseline compare:**
   - `newFindings` are findings not in the baseline.
   - `resolvedFingerprints` are baseline fingerprints not in current.
   - `unchangedFindings` are findings in both.
   - Empty current findings → all fingerprints resolved.
   - Empty baseline → all findings new.
6. **Suppression:**
   - Suppressed findings are excluded by `filterSuppressed(..., false)`.
   - `filterSuppressed(..., true)` includes them.
   - Expired suppressions (`expiresAt` in the past) are not applied.
   - `isSuppressed` returns true for matching, non-expired suppressions.
7. **Only-new filtering:**
   - `filterOnlyNew` returns only findings not in the baseline.
   - Suppressed findings are excluded from new findings.
8. **Baseline I/O:**
   - `loadBaseline` reads and parses a JSON file.
   - `saveBaseline` writes a JSON file.
   - Missing file throws `BASELINE_NOT_FOUND`.
   - Invalid JSON throws `BASELINE_INVALID`.
   - Wrong schema version throws `BASELINE_INVALID`.
   - Unwritable path throws `BASELINE_WRITE_FAILED`.
9. **Determinism:**
   - Identical SARIF input + identical context produce identical `Finding[]`
     (same fingerprints, same ids, same field values).
10. **Error cases:**
    - `INVALID_SARIF` for malformed structure.
    - `MISSING_LOCATION` for result without locations.
    - `INVALID_FINGERPRINT_INPUT` for empty `file` or non-positive lines.
    - `BASELINE_NOT_FOUND`, `BASELINE_INVALID`, `BASELINE_WRITE_FAILED`.
