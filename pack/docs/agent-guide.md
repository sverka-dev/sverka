# Agent Documentation — sverka-gc-pack

This document is for agents running under the sverka-gc-pack harness.
It describes the skills, formulas, and workflow available to them.

## Skills

The pack provides three skills in `pack/skills/`:

### `sverka-wave`

Use when planning or executing a wave. Covers the architect→builder→reviewer→finalize cycle, spec tree navigation, and wave gating.

### `sverka-review`

Use when reviewing a wave implementation. Covers gate commands, two-axis review (Standards + Spec), finding classification, and commit hygiene.

### `sverka-drill`

Use when a wave fails, a builder is stuck, or tests break. Covers drill task creation, scoped investigation, root cause isolation, and prevention planning.

## How agents discover skills

Gas City packs can include a `skills/` directory. Skills in `pack/skills/`
are available to all agents that load the pack. Agents invoke skills via
`skill <name>` in their prompt or through the provider's skill system.

## Formulas

The pack provides three formulas in `pack/formulas/`:

### `wave`

The standard implementation cycle:
1. **design** (architect) — read spec, produce plan
2. **implement** (builder) — TDD implementation
3. **review** (reviewer) — gate quality
4. **finalize** (mayor) — commit, push PR, next wave

### `address-review`

The PR review loop:
1. **address** (builder) — run `/act` on the wave PR, resolve all threads

### `bootstrap-sdd`

The project bootstrap:
1. **spec-tree** (architect) — create numbered spec tree
2. **engdocs** (architect) — create engineering docs structure
3. **monorepo** (builder) — scaffold monorepo
4. **readme** (builder) — write README
5. **website** (builder) — scaffold website
6. **review** (reviewer) — gate bootstrap
7. **finalize** (mayor) — commit, prepare first wave

## Project Context

Each agent receives project-specific context via `append_fragments`. The
project creates a `template-fragments/project-context.md` file that is
appended to every agent's prompt. This file contains:

- Project name and description
- Tech stack
- Directory structure
- Build/test/lint commands
- Wave plan
- Project-specific conventions

## Agent Roles

### Mayor (always-on)

- Plans waves by reading the spec tree
- Dispatches work to architect/builder/reviewer
- Monitors progress, unblocks agents
- Gates quality — every wave passes review before next
- Drills failures — creates drill tasks, never guesses
- Commits and pushes stacked PRs after review approval

### Architect (on-demand)

- Designs specs in `specs/`
- Produces implementation plans in `engdocs/`
- Defines TypeScript interfaces
- Ruthless minimalist — cuts everything non-essential
- Records decisions in `engdocs/adr/`

### Builder (on-demand)

- Implements from specs, TDD-strict
- Writes failing tests first, then implements
- Runs all gates: test, build, lint, typecheck
- Drills failures before patching
- Reports completion to mayor

### Reviewer (on-demand)

- Runs all gates fresh (never trusts builder claims)
- Two-axis review: Standards + Spec
- Classifies findings: BLOCKING, NIT, DECLINE
- Approves or rejects with specific feedback
- Follows `REVIEW.md` policy

## Project Docs

The project owns these docs (not the pack):

- `AGENTS.md` — project conventions, tech stack, commands
- `REVIEW.md` — review policy
- `SECURITY.md` — security policy
- `specs/` — numbered spec tree
- `engdocs/` — engineering docs, ADRs

Agents reference these docs by path. The pack never hardcodes their contents.
