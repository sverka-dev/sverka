# Findings normalization

Sverka normalizes output from any analysis tool into a single `Finding[]`
model. Source: `packages/findings/src/`.

## Finding model

Every finding has:

| Field         | Type     | Description                              |
|---------------|----------|------------------------------------------|
| `id`          | `string` | `{checkId}:{fingerprint}`                |
| `fingerprint` | `string` | SHA-256 of `checkId|rule|file|lines`     |
| `checkId`     | `string` | Check that produced the finding          |
| `severity`    | `Severity` | `info`, `low`, `medium`, `high`, `critical` |
| `confidence`  | `number`  | 0.0–1.0 (default 0.5 for SARIF)        |
| `message`     | `string`  | Human-readable description             |
| `rule`        | `string`  | Rule ID from the originating tool      |
| `file`        | `string`  | Path relative to project root          |
| `startLine`   | `number`  | Start line (1-based)                   |
| `endLine`     | `number`  | End line (1-based, inclusive)          |
| `source`      | `FindingSource` | Tool name, version, format       |

## `normalizeSarif(sarif, context)`

Convert SARIF 2.1.0 output to `Finding[]`.

```ts
import { normalizeSarif } from "@sverka/sdk";

const findings = normalizeSarif(sarifLog, {
  root: "/path/to/project",
  checkIdPrefix: "eslint",
  defaultConfidence: 0.5,
});
```

The normalizer:

- Resolves rule IDs (via `ruleId` or `ruleIndex`).
- Maps SARIF severity levels to Sverka's `Severity` enum.
- Resolves file paths relative to the project root.
- Computes fingerprints for each finding.

## `computeFingerprint(input)`

Deterministic SHA-256 fingerprint. Insensitive to message wording and
severity changes; sensitive to file, rule, and line range.

```ts
import { computeFingerprint } from "@sverka/sdk";

const fp = computeFingerprint({
  checkId: "eslint",
  rule: "no-unused-vars",
  file: "src/index.ts",
  startLine: 10,
  endLine: 10,
});
```

Returns a lowercase hex string.

## Baselines

Baselines track known findings so only new ones are reported.

### `createBaseline(findings)`

Create a baseline from a set of findings.

```ts
import { createBaseline } from "@sverka/sdk";

const baseline = createBaseline(findings);
```

### `updateBaseline(baseline, findings)`

Update an existing baseline with new findings.

### `loadBaseline(path)`

Load a baseline from a JSON file.

### `saveBaseline(baseline, path)`

Save a baseline to a JSON file.

### `filterOnlyNew(findings, baseline)`

Filter findings to only those not in the baseline.

```ts
import { filterOnlyNew } from "@sverka/sdk";

const newFindings = filterOnlyNew(allFindings, baseline);
```

A finding is "new" if its fingerprint is not in the baseline's fingerprint
set and not suppressed by a suppression entry.
