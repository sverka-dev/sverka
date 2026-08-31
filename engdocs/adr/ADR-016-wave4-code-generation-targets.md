# ADR-016 — Wave 4 Interoperability Targets are Code Generators, Not Execution Engines

**Status:** Active
**Date:** 2026-08-31
**Related:** ADR-004 (superseded — thin wrapper), ADR-009 (v0 redesign), ADR-011 (canonical runtime), architecture spec §19 (Target Contract), §21 (Engine Contract), §23 (Delegated Engines), §29 (Package Surface)

## Context

v1 mega-plan Wave 4 (sv-wthn.4) calls for three "delegated engines"
(TemporalEngine, DaggerEngine, InngestEngine) and one new target
(Drone/Gitness). The beads describe them as engines that execute Run Plans
on external platforms.

The architecture spec defines two contracts:
- **Target** (§19): `compile(graph: DefinitionGraph): CompilationResult` —
  pure, deterministic, no network, emits artifacts.
- **Engine** (§21): `run(request: RunRequest): AsyncIterable<RunEvent>` —
  executes, streams events, requires cancellation.

§23 defines **delegated engines** as consuming *emitted provider
configuration* (act runs GitHub YAML, gitlab-ci-local runs GitLab YAML).
They are compatibility backends, not the source of Sverka semantics.

Temporal, Dagger, and Inngest are **external orchestration platforms**.
"Executing" on them requires:
- Temporal: `@temporalio/sdk` + a running Temporal server + worker
- Dagger: Dagger CLI + engine daemon
- Inngest: `@inngest/agent-kit` + Inngest dashboard/deployment

§29 states: "Optional connectors and delegated engines SHOULD not become
mandatory dependencies of the core package."

## Decision

**All four Wave 4 integrations are Targets (code generators), not Engines.**

They implement the existing `Target` contract (`compile(graph):
CompilationResult`) and emit platform-native source code from a
DefinitionGraph. No SDK dependencies, no running infrastructure, no
execution, no event streaming.

| Integration | Input | Output | Package |
|---|---|---|---|
| Temporal | DefinitionGraph | Temporal Workflow `.ts` + activities `.ts` | `@sverka/compiler` (temporal sub-module) |
| Dagger | DefinitionGraph | Dagger Module `.ts` | `@sverka/compiler` (dagger sub-module) |
| Inngest | DefinitionGraph | Inngest function `.ts` | `@sverka/compiler` (inngest sub-module) |
| Drone | DefinitionGraph | `.drone.yml` | `@sverka/compiler` (drone sub-module) |

The user deploys the generated code to their platform. This is how
Temporal, Dagger, and Inngest actually work — you write code and deploy it.

## Rationale

1. **No SDK dependencies.** Code generation is pure string templating.
   The generated code references platform SDKs; Sverka does not.

2. **No running infrastructure.** No Temporal server, Dagger daemon, or
   Inngest deployment is required to produce the output.

3. **Consistent with existing patterns.** The GitHub and GitLab targets
   already compile a DefinitionGraph to YAML artifacts. These four do the
   same — the output format is TypeScript instead of YAML.

4. **The Engine.run() contract is wrong for these platforms.** It requires
   live execution with event streaming. Temporal/Dagger/Inngest execution
   happens on *their* infrastructure, not in-process. A real execution
   adapter would need SDK clients, network connections, and long-running
   sessions — all anti-patterns for a deterministic compiler package.

5. **§23 delegated engines are a different concept.** They run *emitted CI
   config* locally (act, gitlab-ci-local). Temporal/Dagger/Inngest don't
   consume emitted config — they have their own SDKs and deployment models.

6. **The value is interoperability, not execution.** Users get
   platform-native code they can deploy, customize, and maintain. This is
   the standard development pattern for all three platforms.

## Consequences

- Four new sub-modules in `@sverka/compiler`: `temporal/`, `dagger/`,
  `inngest/`, `drone/`. No new packages, no new external dependencies.
- Each implements `Target` (analyze → lower → emit), following the exact
  pattern of `github/` and `gitlab/`.
- Capability manifests declare what each platform supports natively,
  lowers, emulates, or does not support.
- **Follow-up beads:** real execution adapters (Temporal SDK client,
  Dagger CLI driver, Inngest deployment) for users who want Sverka to
  submit and monitor runs directly. These would be separate packages
  (`@sverka/engine-temporal` etc.) with platform SDK dependencies.
- The mega-plan's "delegated engine" framing is revised: v1 ships code
  generation; execution adapters are M3+ scope.
- No changes to the Engine contract (§21) or the native engine.
