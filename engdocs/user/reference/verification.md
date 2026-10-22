# Verification package (@sverka/verification)

`@sverka/verification` is the findings engine in one package — check
resolution (Spec 14), SARIF normalization and baselines (Spec 15), and
policy evaluation (Spec 16) live under `src/checks`, `src/findings`, and
`src/policy` behind a single barrel export. It is a **standalone
package**: it depends on no other `@sverka/*` runtime, so SARIF tooling
(the viewers, the reporter, the hub, the playground) can consume
`Finding[]` without pulling in the workflow engine.

```text
                @sverka/verification
   ┌──────────────────┬──────────────────┬──────────────────┐
   │ checks/          │ findings/        │ policy/          │
   │ ProposedCheck →  │ SARIF → Finding  │ Finding[] +      │
   │ StepDefinition   │ fingerprint,     │ rules → verdict  │
   │ + SARIF extract  │ baseline, search │ + graph verify   │
   └──────────────────┴──────────────────┴──────────────────┘
```

## The three surfaces

**Findings (Spec 15)** — the normalized `Finding` model and everything
around it:

```ts
import {
  normalizeSarif, // SARIF 2.1.0 → Finding[]
  serializeSarif, // Finding[] → SARIF 2.1.0
  computeFingerprint, // stable finding identity
  createBaseline,
  updateBaseline,
  compareBaseline,
  loadBaseline,
  saveBaseline,
  isSuppressed,
  filterSuppressed,
  filterOnlyNew,
  searchFindings,
  filterBySeverity,
} from "@sverka/verification";
```

Detail: [Findings normalization](./findings.md).

**Policy (Spec 16)** — findings → verdict:

```ts
import {
  DEFAULT_POLICY,
  createPolicy,
  evaluatePolicy,
  verifyPolicyAgainstGraph, // validate policy checkIds against the graph
} from "@sverka/verification";
```

Detail: [Policy evaluation](./policy.md).

**Checks (Spec 14)** — `ProposedCheck` → runnable `StepDefinition`, and
SARIF extraction back out of step outputs:

```ts
import {
  createBuiltinResolver, // built-in checkId → command table
  synthesizeCheckSteps, // ProposedCheck[] → StepDefinition[]
  extractFindings, // CheckOutput[] → Finding[] (SARIF artifacts)
} from "@sverka/verification";
```

Detail: [Built-in checks](./checks.md).

## Import paths: package vs SDK

The CLI's programmatic surface (`@sverka/sdk`) re-exports the common
subset — `Finding`, `normalizeSarif`, `computeFingerprint`, the baseline
helpers, `filterOnlyNew`, `DEFAULT_POLICY`/`createPolicy`/
`evaluatePolicy`, `createBuiltinResolver`, `extractFindings`,
`CheckError`, and the policy/check types. Import from `@sverka/sdk` when
you're composing a run; import from `@sverka/verification` directly when
you only need the findings model — it's the lighter dependency and the
one the standalone viewers use.

```ts
// same symbol, two paths — pick per the dependency you already carry
import { normalizeSarif } from "@sverka/sdk"; // composing a workflow run
import { normalizeSarif } from "@sverka/verification"; // SARIF tooling only
```

## SARIF in both directions

`normalizeSarif` and `serializeSarif` make the package a two-way bridge:
external tools' SARIF output becomes `Finding[]` for policy and
reporting, and sverka findings serialize back to SARIF 2.1.0 for code
scanning uploads and the viewers. `resolveSarifInput` +
`DEFAULT_NORMALIZE_CONTEXT` are the input-resolution helpers the CLIs
share; `SarifLog`/`SarifRun`/`SarifRule`/`SarifResult`/`SarifLocation`
are the SARIF types.

## Errors

Each surface has its own error class with a `cause`: `CheckError`
(`CheckErrorCode`), `NormalizationError` (`NormalizationErrorCode`),
`BaselineError` (`BaselineErrorCode`), and `PolicyError`
(`PolicyErrorCode`).

## Test helpers

`makeFinding`, `makeSarif`, and `VALID_SARIF_JSON` are exported for
downstream tests — fixtures that produce well-formed findings and SARIF
logs without hand-writing the shapes.

## See also

- [Built-in checks](./checks.md) — checkId table and resolver
- [Findings normalization](./findings.md) — Finding model, fingerprints,
  baselines
- [Policy evaluation](./policy.md) — rules, severities, verdicts
- [SARIF pipeline](../findings/sarif-pipeline.md) — the viewers built on
  this package
- [Reporter](./reporter.md) — the run-report pipeline that consumes
  `Finding[]`
