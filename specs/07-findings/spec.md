# Spec 07 — Findings Package: Normalization, Fingerprints, Baseline

## Overview

The `findings` package normalizes output from heterogeneous analysis tools into
a single canonical `Finding` model. It computes stable fingerprints so findings
can be tracked across runs, maintains a baseline of known findings, supports
suppression of false positives, and provides `--only-new` filtering so
repeated runs report only newly introduced issues.

Every finding — whether from SARIF, ESLint, Semgrep, SonarCloud, or a custom
check — is normalized to the same shape before it reaches policy evaluation or
the CLI output layer.

## Goals

1. Normalize findings from heterogeneous tools into one canonical `Finding`
   model.
2. Normalize SARIF 2.1.0 output specifically, since it is the interchange
   format for many tools.
3. Compute deterministic fingerprints that are stable across runs and
   insensitive to cosmetic changes (whitespace, message wording).
4. Maintain a baseline file of known findings that can be created, updated, and
   compared.
5. Support suppression of findings via inline comments and baseline entries.
6. Provide `--only-new` filtering that returns findings not present in the
   baseline.
7. Preserve the original tool source on every finding for traceability.
8. Support severity and confidence normalization across tools that use
   different scales.
9. Be fully deterministic: identical tool output produces identical normalized
   findings and fingerprints.
10. Export all public types and functions from `src/index.ts`.

## Non-goals (v1)

- Re-implementing static analysis tools.
- Deduplicating findings across tools that report the same issue (future work).
- Automatically fixing findings.
- Hosting a findings database or dashboard.
- Supporting SARIF extensions and taxonomies beyond what is needed for
  normalization.

## Interfaces

```typescript
/**
 * A normalized finding from any analysis tool.
 */
export interface Finding {
  /** Stable unique identifier for this finding. */
  id: string;
  /** Deterministic fingerprint used for baseline tracking. */
  fingerprint: string;
  /** Identifier of the check that produced this finding. */
  checkId: string;
  /** Severity level. */
  severity: Severity;
  /** Confidence level (0.0–1.0). */
  confidence: number;
  /** Human-readable message describing the finding. */
  message: string;
  /** Rule identifier from the originating tool. */
  rule: string;
  /** File path relative to project root. */
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
  /** Optional CWE or other taxonomy references. */
  tags?: string[];
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
 * Normalizes raw tool output into Findings.
 */
export interface FindingNormalizer {
  /** The tool name this normalizer handles. */
  readonly tool: string;
  /** The input format this normalizer accepts. */
  readonly format: "sarif" | "json" | "text" | "custom";
  /**
   * Normalize raw output into Findings.
   * @param raw Raw tool output as a string or parsed object.
   * @param context Normalization context with project root.
   */
  normalize(raw: unknown, context: NormalizeContext): Finding[];
}

/**
 * Context passed to normalizers.
 */
export interface NormalizeContext {
  /** Project root for resolving relative paths. */
  root: string;
  /** Default check ID prefix. */
  checkIdPrefix: string;
  /** Default confidence when the tool does not provide one. */
  defaultConfidence: number;
}

/**
 * Computes a deterministic fingerprint for a finding.
 */
export interface Fingerprinter {
  /**
   * Compute a stable fingerprint for the given finding data.
   * The fingerprint must be insensitive to message wording changes and
   * whitespace, but sensitive to file, rule, and line range.
   */
  compute(input: FingerprintInput): string;
}

/**
 * Input to fingerprint computation.
 */
export interface FingerprintInput {
  rule: string;
  file: string;
  startLine: number;
  endLine: number;
  checkId: string;
}

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
  /** When the baseline was created. */
  createdAt: string;
  /** When the baseline was last updated. */
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
  /** When the suppression was created. */
  createdAt: string;
  /** Optional expiry date (ISO 8601). */
  expiresAt?: string;
}

/**
 * Result of comparing findings against a baseline.
 */
export interface BaselineDiff {
  /** Findings not present in the baseline (new). */
  newFindings: Finding[];
  /** Findings present in the baseline but not in current run (resolved). */
  resolvedFindings: Finding[];
  /** Findings present in both (unchanged). */
  unchangedFindings: Finding[];
}

/**
 * Options for baseline operations.
 */
export interface BaselineOptions {
  /** Path to the baseline file. */
  path: string;
  /** Whether to include suppressed findings in results. */
  includeSuppressed: boolean;
}

/**
 * Options for --only-new filtering.
 */
export interface OnlyNewOptions {
  /** Path to the baseline file. */
  baselinePath: string;
  /** Whether to treat missing baseline as all-new. */
  missingBaselineIsAllNew: boolean;
}

/**
 * Normalizes SARIF 2.1.0 output into Findings.
 */
export interface SarifNormalizer extends FindingNormalizer {
  readonly tool: "sarif";
  readonly format: "sarif";
  /**
   * Parse a SARIF log object into Findings.
   * @param sarif Parsed SARIF object.
   * @param context Normalization context.
   */
  normalizeSarif(sarif: SarifLog, context: NormalizeContext): Finding[];
}

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
  ruleId: string;
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
 * Error thrown when normalization fails.
 */
export class NormalizationError extends Error {
  readonly code: string;
  readonly cause: unknown;
  constructor(message: string, code: string, cause?: unknown) {
    super(message);
    this.name = "NormalizationError";
    this.code = code;
    this.cause = cause;
  }
}

/**
 * Error thrown when baseline operations fail.
 */
export class BaselineError extends Error {
  readonly code: string;
  readonly cause: unknown;
  constructor(message: string, code: string, cause?: unknown) {
    super(message);
    this.name = "BaselineError";
    this.code = code;
    this.cause = cause;
  }
}
```

## Data models

### Finding normalization pipeline

1. **Raw output is received** as a string or parsed object from a check
   execution.
2. **The appropriate `FindingNormalizer` is selected** based on the tool name
   and output format.
3. **The normalizer produces `Finding[]`** with all fields populated. Missing
   fields receive defaults:
   - `severity`: `"info"` when the tool does not provide severity.
   - `confidence`: `defaultConfidence` from `NormalizeContext` (default 0.5).
   - `helpUrl`: `undefined` when not provided.
4. **Fingerprints are computed** by the `Fingerprinter` after normalization,
   using `rule`, `file`, `startLine`, `endLine`, and `checkId`.
5. **IDs are assigned** as `{checkId}:{fingerprint}` to ensure uniqueness
   within a run.

### SARIF normalization

SARIF level-to-severity mapping:

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
`tool.driver.rules` array by matching `ruleId` or `ruleIndex`.

### Fingerprint computation

Fingerprints are computed as a SHA-256 hash of a canonical string:

```
sha256("{checkId}|{rule}|{normalizedFile}|{startLine}|{endLine}")
```

- `normalizedFile` is the file path with `\\` replaced by `/` and made relative
  to the project root.
- The fingerprint deliberately excludes `message` so that reworded messages do
  not create new findings.
- The fingerprint deliberately excludes `severity` so that severity changes do
  not create new findings (severity changes are tracked separately).
- The fingerprint is a lowercase hex string.

### Baseline file format

The baseline is a JSON file (default: `.sverka/baseline.json`) with this
structure:

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

- **Create:** Write a new baseline from a set of findings. All fingerprints
  are added. No suppressions.
- **Update:** Merge new findings into an existing baseline. Resolved findings
  are removed from `fingerprints`. Suppressions for resolved fingerprints are
  removed. `updatedAt` is refreshed.
- **Compare:** Produce a `BaselineDiff` by comparing current findings against
  the baseline. A finding is "new" if its fingerprint is not in
  `baseline.fingerprints`. A finding is "resolved" if its fingerprint is in
  the baseline but not in the current set. Otherwise it is "unchanged".

### Suppression

Suppressions are matched by fingerprint. A finding is suppressed if:

1. Its fingerprint matches a suppression entry, AND
2. The suppression has not expired (`expiresAt` is in the future or absent).

Suppressed findings are excluded from policy evaluation and from `--only-new`
results by default. They can be included via `includeSuppressed: true`.

Inline suppressions are detected from source code comments matching:

- `// sverka-ignore-next-line` (TypeScript/JavaScript)
- `# sverka-ignore-next-line` (Python)
- `// sverka-ignore` on the same line

Inline suppressions are processed before baseline comparison.

### `--only-new` filtering

1. Load the baseline from `baselinePath`.
2. If the baseline does not exist and `missingBaselineIsAllNew` is `true`,
   all findings are returned as new.
3. If the baseline does not exist and `missingBaselineIsAllNew` is `false`,
   an error is thrown.
4. Otherwise, return only findings whose fingerprints are not in
   `baseline.fingerprints` and are not suppressed.

## Error handling

- **`NormalizationError`** is thrown for malformed tool output:
  - `INVALID_SARIF` — SARIF does not conform to 2.1.0 structure.
  - `UNSUPPORTED_FORMAT` — no normalizer is registered for the tool/format.
  - `MISSING_LOCATION` — a SARIF result has no location.
  - `PARSE_ERROR` — raw output could not be parsed.
- **`BaselineError`** is thrown for baseline file issues:
  - `BASELINE_NOT_FOUND` — baseline file does not exist.
  - `BASELINE_INVALID` — baseline file is not valid JSON or wrong schema
    version.
  - `BASELINE_WRITE_FAILED` — baseline file could not be written.
  - `SUPPRESSION_EXPIRED` — a suppression has expired (warning, not fatal).
- **Fingerprint computation never throws** for valid `FingerprintInput`. It
  throws `NormalizationError` with code `INVALID_FINGERPRINT_INPUT` if required
  fields are missing or empty.
- All errors include a `cause` field typed as `unknown`.
- No `any` types are used.

## Test plan

Tests live in `packages/findings/src/__tests__/` and run via `bun test`.

1. **SARIF normalization:**
   - A minimal SARIF log with one result produces one `Finding`.
   - SARIF levels map to correct severities (`error`→`high`, `warning`→
     `medium`, `note`→`low`, `none`→`info`).
   - Rule metadata (`helpUri`, `shortDescription`) is extracted from
     `tool.driver.rules`.
   - `ruleIndex` is used when `ruleId` is absent.
   - Multi-location results produce one finding per location.
   - Results without locations throw `MISSING_LOCATION`.
   - Invalid SARIF throws `INVALID_SARIF`.
2. **Fingerprint computation:**
   - Identical inputs produce identical fingerprints.
   - Different `rule` values produce different fingerprints.
   - Different `file` paths produce different fingerprints.
   - Different line ranges produce different fingerprints.
   - Message wording changes do not affect the fingerprint.
   - Severity changes do not affect the fingerprint.
   - Windows backslash paths are normalized to forward slashes.
   - Empty required fields throw `INVALID_FINGERPRINT_INPUT`.
3. **Baseline create:**
   - A new baseline is written with all fingerprints.
   - `createdAt` and `updatedAt` are set.
   - `version` is 1.
   - No suppressions are present initially.
4. **Baseline update:**
   - New findings are added to the baseline.
   - Resolved findings are removed.
   - Suppressions for resolved fingerprints are removed.
   - `updatedAt` is refreshed.
5. **Baseline compare:**
   - New findings are identified correctly.
   - Resolved findings are identified correctly.
   - Unchanged findings are identified correctly.
   - Empty current findings produce all-resolved.
   - Empty baseline produces all-new.
6. **Suppression:**
   - Suppressed findings are excluded by default.
   - `includeSuppressed: true` includes them.
   - Expired suppressions are not applied.
   - Inline `sverka-ignore-next-line` suppresses the next line's findings.
   - Inline `sverka-ignore` on the same line suppresses that line's findings.
7. **`--only-new` filtering:**
   - Only findings not in the baseline are returned.
   - Missing baseline with `missingBaselineIsAllNew: true` returns all.
   - Missing baseline with `missingBaselineIsAllNew: false` throws
     `BASELINE_NOT_FOUND`.
   - Suppressed findings are excluded from new findings.
8. **Determinism:**
   - Identical tool output produces identical normalized findings and
     fingerprints across runs.
9. **Error cases:**
   - `UNSUPPORTED_FORMAT` when no normalizer is registered.
   - `PARSE_ERROR` for malformed JSON input.
   - `BASELINE_INVALID` for wrong schema version.
   - `BASELINE_WRITE_FAILED` when the baseline directory does not exist.
