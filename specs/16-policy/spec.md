# Spec 16 — Policy

**Status:** Active (carry-over + Definition Graph verification)
**Source:** specs/architecture-spec.md §26, §27
**Package:** `@sverka/policy` (extended)

## Overview

The policy package evaluates findings against a policy definition to
produce a pass/fail verdict. It is a carry-over package — the core
evaluation logic is unchanged. Wave K adds `verifyPolicyAgainstGraph`,
which checks that a policy's `checkIds` references match actual check
steps in a Definition Graph.

## Goals

- Verify existing policy evaluation works with findings from the new
  engine + checks pipeline
- Add `verifyPolicyAgainstGraph(policy, graph)`: validates that all
  `failOn[].checkIds` in a policy reference steps that exist in the
  Definition Graph (specifically steps with IDs matching `checks/*`)
- Report unknown check IDs as verification errors
- No changes to existing evaluation logic

## Non-goals

- Policy definition syntax (YAML/JSON config parsing)
- Policy enforcement in the engine (the engine runs steps; policy is
  evaluated post-execution by the CLI or orchestrator)
- Provider-specific policy translation
- Dynamic policy rules (§32 — deferred)

## Interfaces

```ts
import type { DefinitionGraph } from "@sverka/core";
import type { Policy } from "./types.js";

interface PolicyVerification {
  readonly valid: boolean;
  readonly unknownCheckIds: readonly string[];
}

function verifyPolicyAgainstGraph(policy: Policy, graph: DefinitionGraph): PolicyVerification;
```

### Exports

```ts
export { verifyPolicyAgainstGraph };
export type { PolicyVerification };
// All existing exports unchanged.
```

## Data models

**Verification**: `verifyPolicyAgainstGraph` collects all `checkIds`
referenced across all `failOn` rules in the policy. It then checks each
against the step IDs in the graph's pipelines. A check ID matches if a
step with that ID exists (typically `checks/<checkId>`). Unknown check
IDs are collected and returned. `valid` is `true` when no unknown check
IDs are found.

## Error handling

Reuses existing `PolicyError` with codes:
- `INVALID_POLICY`: policy is malformed (existing)
- `INVALID_SEVERITY`: rule has unknown severity (existing)

`verifyPolicyAgainstGraph` does not throw — it returns a
`PolicyVerification` with `valid: false` and the list of unknown check
IDs.

## Test plan

1. Regression: all 55 existing policy tests pass unchanged.
2. `verifyPolicyAgainstGraph`: valid policy (all checkIds match) → valid=true.
3. `verifyPolicyAgainstGraph`: unknown checkId → valid=false, listed.
4. `verifyPolicyAgainstGraph`: policy with no checkIds → valid=true.
5. `verifyPolicyAgainstGraph`: multiple unknown checkIds → all listed.
6. Public API: all exports present, no any types.
