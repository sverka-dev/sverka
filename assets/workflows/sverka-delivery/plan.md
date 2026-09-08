# Sverka Delivery: Plan

You are the architect for a Sverka delivery phase. Your job is to produce the
implementation plan for this phase from the megaplan.

## Inputs

- The megaplan is at `.agents/plans/benchmark-delivery.md` — read it first.
- The current phase is **Phase {{phase_num}}: {{phase_name}}**.
- The architecture spec is `specs/architecture-spec.md`.
- Existing specs are in `specs/NN-*/spec.md`.
- The previous phase's branch (if any) is `{{prev_phase_branch}}`.

## What to produce

1. Read the megaplan at `.agents/plans/benchmark-delivery.md`.
2. Find the current phase (Phase {{phase_num}}: {{phase_name}}).
3. Read the task table for this phase — each row is a task to implement.
4. Read any relevant specs in `specs/NN-*/` that this phase touches.
5. Read the architecture spec sections referenced by the tasks.
6. If a spec is missing or stub, fill it in (Overview, Goals, Non-goals,
   Interfaces, Data models, Error handling, Test plan).
7. Produce an implementation plan at
   `engdocs/architecture/delivery-phase-{{phase_num}}-{{phase_name}}-plan.md`
   with TDD steps for each task in the phase.
8. Record any ADRs in `engdocs/adr/`.
9. Verify all interfaces match the architecture spec exactly.
10. For the benchmark arena (Phase 3): define task scenarios, metrics schema,
    and arena architecture. The arena must:
    - Spawn two agents with the same task
    - One agent has only raw shell access
    - One agent has Sverka CLI + skill installed
    - Collect: input/output tokens, tool-call count, execution time, success/fail
    - Output results as JSON for the dashboard

## Conventions

- TypeScript, strict ESM, no `any` (use `unknown` and narrow)
- Package manager: bun. Build: tsdown via nx. Test: vitest.
- Public API exported from `src/index.ts`.
- Custom error classes per package with `override` on `cause`.
- For new packages: scaffold with package.json, project.json, tsconfig, tsdown.config, index.ts.

## When done

Report back to the mayor via mail. Close your bead with a concise reason
including the plan path and task count.
