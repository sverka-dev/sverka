# ADR-004: Thin wrapper CI compiler first

**Status: SUPERSEDED** (2026-08-13, v0 redesign)

## Context

Sverka needs to compile workflows to GitHub Actions and GitLab CI. The
question is whether to generate native CI jobs or a thin wrapper that
runs the Sverka runner.

## Decision (original)

The first CI compiler implementation emits a thin wrapper around the Sverka
runner. Native job expansion is a later optimization.

## Supersession

This decision is **superseded** by the v0 architecture spec
(`specs/architecture-spec.md` §19, §27, §34) and the reconciliation plan
(`engdocs/architecture/v0-architecture-spec-reconciliation.md`).

The architecture spec requires **real target lowering**: each target
implements `analyze()`/`lower()`/`emit()` and produces native CI jobs (one
job per Step with `needs`, `runs-on`, operation→step mapping, artifact
transfer between jobs). The thin-wrapper approach (single job running
`sverka execute`) is the "hosted engine mode" fallback (§28 strategy 2),
retained for capabilities a target cannot lower natively — but it is NOT
the primary compilation mode.

## What changed

The original decision optimized for shipping speed. The architecture spec
prioritizes provider-native output as the primary product goal (§27 Level 1,
§34 acceptance criterion 3: "the graph compiles to valid GitHub and GitLab
artifacts"). The thin wrapper does not satisfy this criterion — it produces
a wrapper, not a native compilation of the definition.

## Consequences (original, now void)

- ~~Phase 3 (Portable CI) ships faster with less complexity.~~
- ~~The wrapper runs `sverka execute .sverka/plan.json` in a single job.~~
- ~~All check logic runs inside Sverka, not in the CI provider's native format.~~
- ~~Native job expansion (Phase 4) can be added later.~~

## Alternatives

- **Native job expansion (ADOPTED):** The v0 redesign implements native
  lowering as the primary target mode. Waves H (GitHub) and I (GitLab).
- **No CI compilation:** Rejected — CI compilation is a core feature.
