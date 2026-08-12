# ADR-010: Constructs / Core package boundary

**Status:** Active
**Date:** 2026-08-13

## Context

Wave A of the v0 redesign creates two packages: `@sverka/constructs` (new) and
`@sverka/core` (rebuilt). The architecture spec (§8, §10, §16) requires a
construct tree (ownership, identity, composition) separate from a Definition
Graph (scheduling, dependencies, data transfer). Shared model types — Trigger,
Reference, Runtime, Input, Output — are used by both structures.

The question is which package owns the shared model types and which owns the
Definition Graph + synthesis.

## Decision

- **`@sverka/constructs`** owns: SverkaConstruct, Project, Pipeline, Step,
  ShellStep, Entry (construct classes) + shared model types (Trigger,
  Reference, Runtime, Input, Output). Depends only on `constructs@10.8.1` (npm).
- **`@sverka/core`** owns: Definition Graph types (ProjectDefinition,
  StepDefinition, etc.), OperationDefinition, Dependency, `synthesize()`,
  validation. Depends on `@sverka/constructs`.

Dependency direction: `core → constructs`. No circular dependencies. The
foundation layer (`constructs`) has zero `@sverka/*` deps.

## Rationale

The shared model types are part of the authoring API — users create References,
Triggers, and Outputs when building the construct tree. They live in the lower
layer. The Definition Graph is a derived structure produced by synthesis; it
lives in the higher layer that imports the model types.

Operation types (shell, exportOutput, exportArtifact, importArtifact,
diagnostic) are Definition Graph concepts — they are produced by synthesis, not
authored directly. They live in `core`.

## Consequences

- `@sverka/constructs` is the foundation: no `@sverka/*` dependencies.
- `@sverka/core` depends on `@sverka/constructs` for model types and the
  Project input to `synthesize()`.
- SDK (Wave C) and Decorators (Wave D) depend on `@sverka/constructs` (they
  build construct trees) and optionally `@sverka/core` (for `synthesize()`).
- IR (Wave B) depends on `@sverka/core` for Definition Graph types to
  serialize.

## Alternatives

- **Single package (constructs + core merged):** Rejected — the architecture
  spec §8.3 mandates separation of construct tree and execution graph. Two
  packages enforce this boundary at the module level.
- **Three packages (shared model in a third `@sverka/model`):** Rejected —
  adds a package for ~5 interfaces. The model types naturally belong with the
  constructs that use them. `core` importing from `constructs` is clean.
- **Model types in `core`, constructs imports from core:** Rejected — creates
  the wrong dependency direction. Constructs are the foundation; core is the
  synthesis layer on top.
