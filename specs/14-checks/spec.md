# Spec 14 — Checks Integration

**Status:** Active
**Source:** specs/architecture-spec.md §24, §25
**Package:** `@sverka/checks` (adapted)

## Overview

The checks package bridges the planner's `ProposedCheck` output and the
Definition Graph. It resolves proposed checks into `StepDefinition`
objects with shell operations, and extracts findings from check output
files (SARIF). It integrates with the planner (discovery → proposed
checks) and the engine (Run Plan execution → findings extraction).

## Goals

- `CheckResolver`: resolves a `ProposedCheck` into a `ResolvedCheck`
  containing a `StepDefinition` with shell operations
- `createBuiltinResolver()`: resolver backed by the existing resolution
  table (checkId + packageManager → command)
- `synthesizeCheckSteps(proposedChecks, ctx, resolver)`: converts
  proposed checks into `ResolvedCheck[]` for inclusion in a Definition
  Graph, preserving each resolver's `outputs` metadata
- `extractFindings(outputs, artifactDir, checkId)`: extracts findings
  from SARIF output files (reused from existing implementation)
- Integration with planner: `ProposedCheck` → `ResolvedCheck` → `StepDefinition`
- Integration with engine: check runs as shell step, outputs extracted
  post-execution

## Non-goals

- Plugin-based custom resolvers (Wave E — Plugin model)
- Non-SARIF output formats (deferred — only SARIF in v0)
- Check caching (§32 — deferred)
- Check retry policy (§32 — deferred)
- Capability manifest analysis (Wave E)
- Provider-native check actions (deferred)

## Interfaces

```ts
import type { StepDefinition } from "@sverka/core";
import type { ProposedCheck, ProjectContext } from "@sverka/planner";
import type { Finding } from "@sverka/findings";

interface CheckResolver {
  resolve(check: ProposedCheck, ctx: ProjectContext): ResolvedCheck | null;
}

interface ResolvedCheck {
  readonly checkId: string;
  readonly step: StepDefinition;
  readonly outputs: readonly CheckOutput[];
}

interface CheckOutput {
  readonly path: string;
  readonly format: "sarif" | "json" | "junit" | "text";
}

function createBuiltinResolver(): CheckResolver;
function synthesizeCheckSteps(
  checks: readonly ProposedCheck[],
  ctx: ProjectContext,
  resolver: CheckResolver,
): readonly ResolvedCheck[];
async function extractFindings(
  outputs: readonly CheckOutput[],
  artifactDir: string,
  checkId: string,
): Promise<readonly Finding[]>;
```

### Exports

```ts
export type { CheckResolver, ResolvedCheck, CheckOutput };
export { createBuiltinResolver, synthesizeCheckSteps, extractFindings };
export { CheckError };
export type { CheckErrorCode };
```

## Data models

**Resolution**: The resolver table maps `(checkId, packageManager)` →
`(command, args)`. The resolver creates a `StepDefinition` with:
- `id`: `checks/<checkId>` (e.g., `checks/typecheck`)
- `runtime`: `{ mode: "host", workingDir: <project root> }` (checks run on host in v0)
- `operations`: a single `shell` operation with `command` and `args`
  joined as a safely-quoted shell command string
- `inputs`: `[]` (no inputs in v0)
- `outputs`: `[]` (findings extracted post-execution, not via graph outputs)
- `dependencies`: `[]` (checks are independent by default)

**Synthesis**: `synthesizeCheckSteps` iterates proposed checks, resolves
each via the resolver, collects the resulting `ResolvedCheck[]` while
preserving resolver `outputs`. Checks that fail resolution (resolver returns
null) are skipped.

**Step ID generation**: Check steps use the ID pattern `checks/<checkId>`.
If multiple checks have the same checkId (e.g., from different ecosystems),
they are deduplicated — only the first resolved check for each checkId
is included.

**Findings extraction**: Reused unchanged from existing implementation.
Reads SARIF files from the artifact directory, normalizes via
`@sverka/findings.normalizeSarif`, returns `Finding[]`.

## Error handling

Reuses existing `CheckError` with codes:
- `RESOLUTION_FAILED`: check resolution failed
- `EXTRACTION_FAILED`: SARIF extraction or normalization failed

## Test plan

1. `createBuiltinResolver`: returns a CheckResolver.
2. Resolver resolves typecheck for Node/bun → StepDefinition with shell command.
3. Resolver resolves lint for Node/npm → StepDefinition.
4. Resolver returns null for unknown checkId.
5. Resolver validates package.json scripts (Node entries).
6. `synthesizeCheckSteps`: converts proposed checks to ResolvedCheck[], preserving `outputs`.
7. `synthesizeCheckSteps`: skips checks that fail resolution.
8. `synthesizeCheckSteps`: deduplicates by checkId.
9. `synthesizeCheckSteps`: step IDs follow `checks/<checkId>` pattern.
10. `synthesizeCheckSteps`: steps have `runtime.mode === "host"`.
11. `extractFindings`: extracts findings from SARIF file (reused).
12. `extractFindings`: missing file → skipped (no findings).
13. `extractFindings`: invalid SARIF → throws CheckError.
14. `CheckError`: extends Error with code and cause.
15. Public API: all exports present, no any types.
16. Regression: existing resolver table entries still work.
