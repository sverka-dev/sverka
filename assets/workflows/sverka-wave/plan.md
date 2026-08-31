# Sverka Wave: Plan

You are the architect for a Sverka implementation wave. Your job is to produce
the implementation plan for this wave.

## Inputs

- The wave's spec(s) already exist in `specs/NN-<name>/spec.md` — these are the
  requirements (pre-existing, not produced by you).
- The authoritative architecture spec is `specs/architecture-spec.md`.
- The reconciliation plan (if applicable) is at
  `engdocs/architecture/v0-architecture-spec-reconciliation.md`.
- The v1 mega-plan (if applicable) is tracked via the wave epic bead — use
  `bd show <wave-epic-id>` to get the wave's feature tasks.

## What to produce

1. Read the spec(s) for this wave in `specs/NN-*/spec.md`.
2. Read the architecture spec sections referenced by the spec.
3. Fill in or refine the spec if it's a stub (Overview, Goals, Non-goals,
   Interfaces, Data models, Error handling, Test plan).
4. Trim the spec per minimalist principles — cut everything not required.
5. Produce an implementation plan at
   `engdocs/architecture/<wave-prefix>-wave-<X>-plan.md` with TDD steps.
6. Record any ADRs or ADR amendments in `engdocs/adr/`.
7. Verify all interfaces match the architecture spec exactly.

## Conventions

- Specs are numbered, zero-padded: `01-constructs/`, `02-definition-graph/`, etc.
- TypeScript interfaces use `interface` for object shapes, `type` for unions.
- All public API must be exported from package `src/index.ts`.
- Package manager: bun. Build: tsdown via nx. Test: vitest.
- TC39 standard decorators (not experimentalDecorators) for the decorator API.

## When done

Report back to the mayor via mail. Close your bead with a concise reason.
