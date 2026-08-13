# ADR-009: v0 architecture spec redesign

## Context

The initial Sverka build (waves 0–15) produced a local CI runner with
flat composables and thin-wrapper CI compilers (ADR-004). The architecture
spec (`specs/architecture-spec.md`) describes a fundamentally different
product: a provider-neutral pipeline definition framework with three
authoring surfaces (Construct/SDK/Decorator), a canonical Definition Graph,
and real target lowering to native CI jobs.

The gap is architectural, not cosmetic. The flat `OperationSpec[]` model
cannot carry the information a target needs to emit native jobs (Steps with
separate runtimes, dependencies, outputs, entries/triggers).

## Decision

Adopt the architecture spec as the authoritative source of truth and
execute a full redesign (waves A–N) per the reconciliation plan at
`engdocs/architecture/v0-architecture-spec-reconciliation.md`.

Key changes:
1. **Construct API** using the `constructs` package (spec §8).
2. **Definition Graph** replaces flat Plan IR (spec §10).
3. **Decorator API** using TC39 standard decorators (spec §9.3).
4. **Real target lowering** replaces thin wrappers (spec §19, ADR-004 superseded).
5. **Plugin architecture** with capability manifests (spec §17, §24).
6. **Typed References** with automatic dependency inference (spec §11).

## Reuse

Packages that are engine-agnostic and don't depend on the old IR model are
reused: `findings`, `policy`, `runtime-host`, `runtime-docker` (adapted),
`runtime` scheduler logic (retargeted), `planner` discovery, `checks`
resolver + extract, `cli` shell + output writer.

Packages that depend on the old IR model are rebuilt: `core`, `ir`, `sdk`,
`compiler-github` → `target-github`, `compiler-gitlab` → `target-gitlab`.

## Consequences

- 14 new waves (A–N) with dependency-aware parallelism where possible.
- Old specs archived under `specs/legacy/`; new spec tree in `specs/NN-*/`.
- ADR-004 superseded. ADR-003 (canonical Plan IR) amended: flat Plan →
  Definition Graph + Run Plan. ADR-005 (predecessor resolution) amended:
  generalized to typed References.
- Existing 18 PRs from the old build remain on GitHub; the redesign builds
  on a new branch stack (`v0-a-*`, `v0-b-*`, ...).

## Alternatives

- **Retrofit in place:** Rejected — the data model gap is too fundamental.
  Retrofitting would mean building the new model alongside the old one and
  then deleting the old one, which is a rewrite wearing retrofit's clothes.
- **Keep the thin-wrapper approach:** Rejected — does not satisfy the
  architecture spec's acceptance criteria (§34).
