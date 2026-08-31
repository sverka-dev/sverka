---
name: architecture-review
description: Use when an agent or developer needs a holistic evaluation of a codebase's architecture and public interfaces — module boundaries, layer violations, coupling/cohesion, SOLID adherence, technology-stack fitness, and API/interface design principles — typically before a large refactor, design decision, or major PR merge. Goes deeper than $skill{codehome} (wrong placement of one piece) and broader than $skill{investigate-first} (one area). Outputs a review report, not a fix.
---

# Architecture Review

Goal: produce a structured critique of a codebase's architecture so that refactor, redesign, and major-feature decisions are made with eyes open.

Use this skill when:

- planning a major refactor, rewrite, or migration
- evaluating a proposed dependency, framework, or service split
- auditing a module before merging a large PR
- preparing a tech-radar or stack-fitness report
- periodic health-check of an aging codebase

Do not use this skill when:

- only one file is misplaced (use $skill{codehome})
- only one area is unclear (use $skill{investigate-first})
- only one performance symptom is reported (use $skill{performance-investigation})
- changes are already in progress and need iterative fixes (use $skill{refactoring})

## Review Procedure

### 1. Scope and lens

Define:

- scope: whole repo, one service, one package, one module
- lens: maintainability, testability, deployability, evolvability, security-architecture
- audience: maintainers, tech leads, architects, PMs

A scope too large becomes a survey; too small becomes $skill{codehome}. Pick the smallest scope that the question requires.

### 2. Module dependency analysis

For each module/package/directory in scope:

1. List its declared exports / public surface.
2. List modules that import from it (incoming dependencies).
3. List modules it imports from (outgoing dependencies).
4. Compute:
   - afferent coupling (incoming) — high means many depend on it
   - efferent coupling (outgoing) — high means unstable surface
   - instability I = Ce / (Ca + Ce), range 0-1
   - distance from the main sequence
5. Identify cycles. Each strongly connected component with more than one module is a cycle.
6. Flag god-modules (very high afferent + efferent coupling and large file count).

Use grep/glob/call-graph tools (e.g. `madge`, `dependency-cruiser`, `pydeps`, `cargo-modules`, language-specific analyzers) when available. Fall back to file-level analysis if no tool fits.

### 3. Layer violation detection

Establish the intended layers from the layout (per $skill{repository-onboarding}):

- e.g. `controllers → services → repositories → models`
- or `adapters → application → domain`
- or `ui → api → core`

Then:

- list all cross-layer imports
- flag imports that skip a layer
- flag circular imports across layers
- flag knowledge leaks: domain importing transport, ORM types leaking into the API layer, framework annotations in the data model

### 4. Cohesion check (per module)

For each module, answer:

1. Does this module describe one cohesive responsibility, or multiple?
2. Are its types and functions used together, or scattered?
3. Would removing half the module leave the other half coherent?

Red flags:

- "utils", "helpers", "misc", "common" modules with no thematic focus
- large modules (>500-800 lines) without sub-structure
- modules with one giant class/function and many tiny ones
- modules whose public surface includes types from unrelated domains

### 5. Coupling check (between modules)

For each pair of modules that interact:

- types exchanged (DTO leakage is a strong signal)
- shared mutable state
- shared global configuration
- ordering assumptions (one must be initialized before the other)
- shared third-party dependencies that pin both sides

Prefer:

- value-object communication
- dependency injection over service locators
- interfaces at boundaries, concrete types behind them
- one-way data flow

### 6. SOLID / equivalent principle scan

Quick heuristic check, with examples from the code:

- Single Responsibility: classes/modules with one reason to change
- Open/Closed: extension points vs edit-in-place
- Liskov: subtypes honoring contracts
- Interface Segregation: small client-specific interfaces
- Dependency Inversion: high-level modules not importing low-level details

When the language is not OO, map to the equivalent principles (e.g. package cohesion, type unions, trait composition).

### 7. Technology-stack fitness

Evaluate:

- framework fit for the dominant workload (sync vs async, batch vs realtime, CPU vs IO)
- database choice vs access pattern (read-heavy vs write-heavy, relational vs document vs graph)
- build and deploy surface (time-to-build, time-to-test, time-to-deploy)
- operational cost (memory, startup, cold start)
- security model (authn, authz, secret handling, dependency hygiene)
- observability fit (logs, metrics, traces — completeness and correlation)

Note:

- accidental complexity from premature optimization
- speculative generality (interfaces with one implementation, factory-of-one)
- magic frameworks that hide control flow beyond recovery

### 8. Cross-cutting concerns

- error handling strategy: consistent? centralized? propagated?
- logging: structured? correlated? level conventions?
- configuration: validated? defaulted? hot-reloadable?
- testing: ratio of unit/integration/e2e; are critical paths covered?
- internationalization, accessibility, time-zone handling: if relevant

### 9. Formulate the report

Read the convention note carefully — apply $skill{critical-thinking} when evaluating trade-offs. State opinions as opinions, label hypotheses, and cite file:line evidence.

## Report Template

## Architecture Review: <scope>

## Scope and lens
- Scope:
- Lens:
- Audience:

## Summary
- One paragraph verdict (healthy / mixed / at risk).

## Strengths
- ...

## Concerns (ranked)
1. **<title>** — Severity (high/medium/low) — File evidence: <paths>
   - Description.
   - Why it matters.
   - Recommended next step (single most actionable item).

## Findings

### Module dependency graph
- Afferent / efferent instability, cycles.

### Layer violations
- ...

### Cohesion / coupling hotspots
- ...

### SOLID / equivalent
- ...

### Technology-stack fitness
- ...

### Cross-cutting concerns
- ...

## Recommended sequence
1. Smallest change that improves the worst hot spot.
2. Next.
3. (do not schedule more than the next 1-3 items here; further plans belong in $skill{shared-plan})

## Open questions
- ...

## What this review does NOT cover
- ...

## Stop conditions

Stop and report blocked if:

- scope is too large and cannot be narrowed without missing the audience
- the codebase has no reproducible build and review depends on guessing
- access to architecture docs / ADRs is required and unavailable
- the review becomes speculative without sufficient static evidence — narrow the lens

## API and interface design principles

Architecture reviews often surface API, module, and type boundaries. Keep the design principles in `references/api-design-principles.md` close when evaluating those boundaries:

- **Hyrum's Law** — any observable behavior becomes a de-facto contract.
- **One-Version Rule** — design for one version at a time; extend rather than fork.
- **Contract First** — define the interface before the implementation.
- **Validate at Boundaries** — trust internal code; validate where external input enters.
- **Prefer Addition Over Modification** — make new fields additive and optional.
- **Predictable Naming** — plural nouns for REST resources, camelCase for fields, `is/has/can` for booleans.

For concrete REST/GraphQL/TypeScript patterns and a full verification checklist, see [`references/api-design-principles.md`](references/api-design-principles.md).

## Related skills

- $skill{repository-onboarding} — produce the layout map first if missing.
- $skill{codehome} — escalate "wrong file" findings into $skill{codehome} when one file at a time is the right size.
- $skill{investigate-first} — for any specific concern that requires deep tracing.
- $skill{refactoring} — once a finding is approved, switch to incremental refactors.
- $skill{performance-investigation} — route performance-shaped concerns there.
- $skill{critical-thinking} — challenge opinions in the report before publishing.
- $skill{shared-plan} — track accepted follow-ups.
