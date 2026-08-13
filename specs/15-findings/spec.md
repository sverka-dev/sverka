# Spec 15 — Findings

**Status:** Active (carry-over verification)
**Source:** specs/architecture-spec.md §26, §27
**Package:** `@sverka/findings` (unchanged)

## Overview

The findings package provides SARIF normalization, fingerprinting,
baselining, and suppression. It is a carry-over package — the
implementation is unchanged from the pre-v0 build. Wave K verifies
that it works correctly with the new engine output (Run Plan execution
produces SARIF files that `extractFindings` from `@sverka/checks`
consumes, which in turn calls `normalizeSarif` from this package).

## Goals

- Verify `normalizeSarif` works with SARIF produced by checks running
  under the native engine
- Verify `computeFingerprint` produces stable fingerprints for findings
  from engine-executed checks
- Verify baseline operations (create, update, compare, load, save) work
  with the new finding IDs
- Verify suppression filtering works with the new finding shape
- No API changes — the package is unchanged

## Non-goals

- New SARIF features or format versions
- New fingerprint algorithms
- New baseline formats
- Integration with engine events (findings are extracted post-execution)

## Interfaces

Unchanged from existing implementation:

```ts
function normalizeSarif(log: SarifLog, ctx: NormalizeContext): readonly Finding[];
function computeFingerprint(input: FingerprintInput): string;
function createBaseline(findings: readonly Finding[]): Baseline;
function updateBaseline(baseline: Baseline, findings: readonly Finding[]): Baseline;
function compareBaseline(baseline: Baseline, findings: readonly Finding[]): BaselineDiff;
function loadBaseline(path: string): Promise<Baseline>;
function saveBaseline(baseline: Baseline, path: string): Promise<void>;
function isSuppressed(finding: Finding, suppressions: readonly Suppression[]): boolean;
function filterSuppressed(findings: readonly Finding[], suppressions: readonly Suppression[]): readonly Finding[];
function filterOnlyNew(findings: readonly Finding[], baseline: Baseline): readonly Finding[];
```

## Test plan

1. Regression: all 88 existing findings tests pass unchanged.
2. Integration: `normalizeSarif` + `computeFingerprint` produce stable
   findings from a SARIF sample that the engine would produce.
3. Public API: all exports present, no any types.
