# ADR-003: Canonical Plan IR as source of truth

**Status: AMENDED** (2026-08-13, v0 redesign — ADR-009)

## Context

Sverka needs a stable contract between the SDK, local executor, and target
compilers. The same workflow must run locally and compile to CI providers.

## Decision (original)

The Canonical Plan IR is the single source of truth. GitHub Actions and
GitLab CI are compilation targets, not the source of truth.

## Amendment (v0 redesign)

The flat `Plan { operations: PlanOperation[] }` schema is replaced by two
schemas per the architecture spec (§10, §22):

1. **Definition Graph** — the canonical provider-neutral source of truth
   produced by synthesis. Contains Project → Pipeline → Entry/Trigger →
   Step → Operation with typed References and dependency edges.
2. **Run Plan** — the concrete execution graph produced after binding an
   Entry, Trigger, Inputs, and context (spec §22.1 component 1). The native
   engine consumes this.

Both are serializable and versioned. The principle from the original decision
(provider-neutral IR as source of truth, CI as compilation target) is
retained. The schema shape changes from flat to graph-structured.

## Consequences (amended)

- The Definition Graph is the serializable, stable schema.
- The Run Plan is the executable form after binding.
- Local execution runs the Run Plan via the native engine.
- CI targets lower the Definition Graph to provider-native jobs.
- Both can be locked, replayed, and diffed.
- ADR-006 (SHA-256 content-addressed IDs) applies to Definition Graph node IDs.

## Alternatives

- **GitHub Actions as source of truth:** Would lock us to one provider.
  Rejected — Sverka is provider-agnostic.
- **No IR, compile directly from workflow code:** Would make local execution
  and CI compilation share too much logic. Rejected — the IR provides a
  clean separation.
- **Keep flat Plan IR:** Rejected — cannot carry Step/Entry/Trigger/Reference
  information needed for native target lowering.
