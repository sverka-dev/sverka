# ADR-003: Canonical Plan IR as source of truth

## Context

Sverka needs a stable contract between the SDK, local executor, and target
compilers. The same workflow must run locally and compile to CI providers.

## Decision

The Canonical Plan IR is the single source of truth. GitHub Actions and
GitLab CI are compilation targets, not the source of truth.

## Consequences

- The Plan IR is a serializable, stable schema (`sverka.dev/v1`).
- Local execution runs the Plan IR directly.
- CI compilers translate the Plan IR to provider-specific formats.
- The Plan can be locked, replayed, and diffed.
- Changes to the workflow code produce a new Plan, which can be compared
  to the previous one.

## Alternatives

- **GitHub Actions as source of truth:** Would lock us to one provider.
  Rejected — Sverka is provider-agnostic.
- **No IR, compile directly from workflow code:** Would make local execution
  and CI compilation share too much logic. Rejected — the IR provides a
  clean separation.
