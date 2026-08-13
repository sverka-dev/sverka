# Spec 18 — Conformance

**Status:** Active
**Source:** specs/architecture-spec.md §33, §34
**Package:** `@sverka/conformance` (new)

## Overview

The conformance suite is the §34 acceptance gate for the v0 redesign.
It verifies that all authoring surfaces produce equivalent Definition
Graphs, targets produce correct YAML, the engine executes RunPlans
correctly, and the full pipeline works end-to-end.

## Goals

- Authoring conformance: Construct, SDK, and Decorator APIs produce the
  SAME Definition Graph for the conformance seed pipeline (§33.1)
- Target conformance: GitHub and GitLab lowering produce correct YAML
  for the seed pipeline (§33.2)
- Execution conformance: native engine executes a RunPlan correctly (§33.3)
- Full pipeline: Project → Graph → RunPlan → Engine → Events
- Full compilation: Project → Graph → Target → YAML artifacts
- Serialization round-trip: serializeGraph → deserializeGraph → same graph
- Capability conformance: manifest support levels match behavior (§33.4)
- §34 acceptance criteria verified

## Non-goals

- Importer conformance (§33.5 — future)
- Cross-provider portability diagnostics (future)
- Generated feature documentation from manifests (§34.12 — future)

## Interfaces

```ts
// Conformance seed pipeline — the canonical pipeline used for all tests.
// All three authoring surfaces must produce the same graph for this.
function createSeedWithConstructs(): Project;
function createSeedWithSDK(): Project;
function createSeedWithDecorators(): Project;

// Conformance result
interface ConformanceResult {
  readonly name: string;
  readonly passed: boolean;
  readonly message: string;
}

// Run all conformance checks
function runConformance(): Promise<readonly ConformanceResult[]>;
```

### Exports

```ts
export {
  createSeedWithConstructs,
  createSeedWithSDK,
  createSeedWithDecorators,
  runConformance,
  type ConformanceResult,
};
```

## The conformance seed pipeline

The seed pipeline exercises the §34 acceptance criteria:

```text
Project "conf"
  Pipeline "ci"
    Input: nodeVersion (string, default "22")
    Step "lint": shell "sh -c 'echo ok > "$SVERKA_OUTPUT_DIR/status"; echo lint'"
        outputs: status (string)
    Step "build": shell "sh -c 'echo "got status ${lint.status}"; ...'",
        depends on "lint", inputs: lint.status,
        outputs: dist (artifact, .outputs/dist.txt)
    Step "test": shell "sh -c 'echo test; ...'",
        depends on "build", inputs: build.dist,
        condition: inputs.nodeVersion
    Entry "on-push": trigger push, roots ["test"]
```

## §34 acceptance criteria mapping

| # | Criterion | Conformance test |
|---|---|---|
| 1 | Pipeline authored through 3 APIs | createSeedWith* functions |
| 2 | All 3 synthesize same graph | authoring-conformance test |
| 3 | Graph compiles to GitHub + GitLab | target-conformance test |
| 4 | Graph executes through native engine | execution-conformance test |
| 5 | Scalar output flows between steps | covered by seed + engine |
| 6 | Artifact flows between steps | artifact-transfer test |
| 7 | Container image selected provider-neutrally | runtime-conformance test |
| 8 | Context namespaces available | context test (SDK) |
| 9 | Cycles produce diagnostics | cycle-detection test |
| 10 | Target compilation no network access | target-no-network test |
| 11 | No provider-specific term required | runner §34.11 check |

> §34.12 (Feature docs from manifests) is listed in the Non-goals section as future work and is not part of the v0 acceptance gate.

## Test plan

1. Authoring conformance: 3 APIs produce same graph
2. Target conformance: GitHub lowering produces valid YAML
3. Target conformance: GitLab lowering produces valid YAML
4. Execution conformance: engine runs seed pipeline
5. Full pipeline: Project → Graph → RunPlan → Engine → Events
6. Full compilation: Project → Graph → Target → YAML
7. Serialization round-trip: serialize → deserialize → same graph
8. Capability conformance: manifests match behavior
9. Cycle detection produces diagnostics
10. All §34 criteria verified
