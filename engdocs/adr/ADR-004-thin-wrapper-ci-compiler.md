# ADR-004: Thin wrapper CI compiler first

## Context

Sverka needs to compile workflows to GitHub Actions and GitLab CI. The
question is whether to generate native CI jobs or a thin wrapper that
runs the Sverka runner.

## Decision

The first CI compiler implementation emits a thin wrapper around the Sverka
runner. Native job expansion is a later optimization.

## Consequences

- Phase 3 (Portable CI) ships faster with less complexity.
- The wrapper runs `sverka execute .sverka/plan.json` in a single job.
- All check logic runs inside Sverka, not in the CI provider's native format.
- Native job expansion (Phase 4) can be added later for checks that benefit
  from native CI visibility (e.g., GitHub code scanning annotations).

## Alternatives

- **Native job expansion from the start:** More complex, slower to ship.
  Rejected for v1 — the wrapper model works and is simpler.
- **No CI compilation:** Would require users to run Sverka locally only.
  Rejected — CI compilation is a core feature.
