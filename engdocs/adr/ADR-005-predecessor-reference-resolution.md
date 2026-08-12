# ADR-005: Predecessor-reference resolution model

**Status: AMENDED** (2026-08-13, v0 redesign — ADR-009)

## Context

The original `core` package's `Operation` interface supported `after(predecessors)`
and `pipeline(...ops)` for building dependency edges. The `OperationSpec.dependsOn`
field was `string[]` (ids), but ids were not assigned until planning time.

## Decision (original)

Store predecessor references (Operation objects) internally on the operation
node, not string ids. Resolution to `dependsOn: string[]` happens during
planning, after ids are assigned.

## Amendment (v0 redesign)

The predecessor-reference model is **generalized** to typed References per
the architecture spec (§11). Instead of `after()` being the only way to
create dependencies, the Definition Graph supports:

1. **Control dependency** — one Step must complete before another (§11.2.1).
2. **Value dependency** — a Step consumes a scalar Output from another Step (§11.2.2).
3. **Artifact dependency** — a Step consumes an Artifact from another Step (§11.2.3).

Dependency inference is automatic: when a Step definition contains a Reference
produced by another Step, Sverka adds the appropriate dependency edge (§11.3).

The construct tree carries typed References (to Inputs, Outputs, Artifacts,
context values). During synthesis, References are resolved to dependency edges
on the Definition Graph. The principle from the original decision (resolve
references during synthesis, not at composition time) is retained.

## Consequences (amended)

- Composables and constructs are lazy: no id generation at call time.
- Typed References create dependencies automatically via inference.
- The synthesis phase is the single point of edge resolution and cycle detection.
- Three dependency types (control, value, artifact) instead of one.
- References are typed and addressable through TypeScript properties (§12.2).

## Alternatives

- **Keep only `after()` predecessor refs:** Rejected — cannot express value
  and artifact dependencies, which are required for native target lowering
  (targets need to know which jobs produce/consume which outputs/artifacts).
- **Assign ids at composition time:** Rejected (same reasons as original).
