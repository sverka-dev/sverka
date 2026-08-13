# v0 Architecture Spec Reconciliation & Migration Plan

**Status:** Draft for review
**Date:** 2026-08-13
**Supersedes:** ADR-004 (thin-wrapper CI compiler first), Spec 00 §"Key architectural decisions" items 8–9

## 1. The gap

The architecture spec (`specs/architecture-spec.md`) describes a
**provider-neutral pipeline definition framework** with three authoring
surfaces (Construct / SDK / Decorator), a canonical Definition Graph, and
**real target lowering** (one native CI job per Step).

The built system (waves 0–15) is a **local CI runner** with flat
composables and **thin-wrapper compilers** that emit a single job calling
`sverka execute`. ADR-004 explicitly deferred native lowering.

These are different products. The reconciliation adopts the architecture
spec as the target and maps the existing code onto it.

## 2. What the architecture spec requires that is missing

| Spec section | Requirement | Built state |
|---|---|---|
| §8 | Construct API on `constructs` package | Missing — `core` has flat composables |
| §9.3–9.8 | Decorator API (`@step`, `@entry`, `@input`, `@output`) | Missing entirely |
| §9.2 | SDK as layer *over* Construct API | Inverted — SDK over flat `core` |
| §10 | Definition Graph: Project→Pipeline→Entry/Trigger→Step→Operation | `ir` has flat `Plan{operations:PlanOperation[]}` |
| §11 | Typed References + dependency inference | Missing |
| §17 | Plugin architecture (`SverkaPlugin` facets) | Missing |
| §19 | Target contract: `analyze()`/`lower()`/`emit()` | Compilers are thin wrappers, not targets |
| §24 | Capability model | Missing |
| §22 | Native engine consumes Run Plans (not provider configs) | `runtime` consumes flat `Plan` directly |
| §27 L1 | Definition → native GitHub/GitLab artifacts | Thin wrapper only (§28 hosted-engine mode) |

## 3. Reuse map — what carries over

| Existing package | Disposition | Notes |
|---|---|---|
| `findings` | **Reuse as-is** | Standalone, no `@sverka` deps. SARIF normalization, fingerprints, baseline. |
| `policy` | **Reuse as-is** | Depends on `findings` types only. `evaluatePolicy` is engine-agnostic. |
| `runtime-host` | **Reuse, adapt** | `Executor` interface reusable; `ExecuteRequest` shape changes to carry Step/Operation context. |
| `runtime-docker` | **Reuse, adapt** | Same as runtime-host. Image/digest logic reusable. |
| `runtime` (scheduler) | **Reuse core, adapt** | Topological scheduling, concurrency, retry, cancellation logic reusable. Retarget from `PlanOperation` → Run Plan steps. |
| `planner` (discovery) | **Partial reuse** | Project discovery (detect PMs, propose checks) reusable. Plan *synthesis* rebuilds (produces Definition Graph, not flat Plan). |
| `checks` | **Partial reuse** | `ProposedCheck → ResolvedCheck` concept maps to Step synthesis. `extractFindings` (SARIF) reusable. Resolver table reusable. |
| `cli` | **Partial reuse** | Command shell reusable. Add `synth`/`graph`; change `plan`/`execute`/`validate` semantics. Output writer reusable. |
| `core` | **Discard, rebuild** | Flat composables replaced by Construct API + Definition Graph model. |
| `ir` | **Discard, rebuild** | Flat `Plan` replaced by Definition Graph + Run Plan schemas. |
| `sdk` | **Discard, rebuild** | Rebuilt as layer over constructs. |
| `compiler-github` | **Discard, rebuild** | Thin wrapper → real target (`analyze`/`lower`/`emit`). YAML emission mechanics transferable. |
| `compiler-gitlab` | **Discard, rebuild** | Same. |
| `website`, `engdocs/user` | **Update** | Docs/examples rewritten for new authoring APIs. |

## 4. New package layout (spec §29)

```
packages/
  constructs/          # NEW — construct tree wrapping `constructs` package
  core/                # REBUILD — Definition Graph model + synthesis
  sdk/                 # REBUILD — composables over constructs (sh, artifact, images, ...)
  decorators/          # NEW — @step, @entry, @input, @output (TC39 decorators)
  ir/                  # REBUILD — Definition Graph + Run Plan schemas, validation, serialization
  plugin/              # NEW — SverkaPlugin contract, capability manifests
  target-github/       # REBUILD — real GitHub target (analyze/lower/emit)
  target-gitlab/       # REBUILD — real GitLab target (analyze/lower/emit)
  engine-native/       # REBUILD from runtime — native engine consuming Run Plans
  runtime-host/        # REUSE — host executor (adapt ExecuteRequest)
  runtime-docker/      # REUSE — docker executor (adapt)
  findings/            # REUSE
  policy/              # REUSE
  planner/             # PARTIAL — discovery reused, synthesis rebuilt
  checks/              # PARTIAL — resolver + extract reused
  cli/                 # PARTIAL — shell reused, commands updated
  # Deferred (M1+):
  engine-act/          # NEW — delegated engine (M1)
  engine-gitlab-ci-local/  # NEW — delegated engine (M1)
  connector-github/    # NEW — remote API (M2+)
  connector-gitlab/    # NEW — remote API (M2+)
```

## 5. New spec tree (mapping architecture spec → numbered specs)

Old specs are archived under `specs/legacy/`. New specs replace them.

| New spec | Architecture spec source | Package |
|---|---|---|
| `00-architecture` | §1–7, §35–36 (overview, principles, terminology) | — |
| `01-constructs` | §8 (construct tree, `constructs` package) | `constructs` |
| `02-definition-graph` | §10, §11 (Definition Graph, references, dependency inference) | `core` |
| `03-authoring-sdk` | §9.2, §12, §14, §15 (SDK composables, I/O, context, operations) | `sdk` |
| `04-authoring-decorators` | §9.3–9.8 (decorator API, metadata, method steps) | `decorators` |
| `05-synthesis` | §16 (synthesis lifecycle: discover→instantiate→normalize→validate→graph) | `core` |
| `06-ir` | §10 (Definition Graph + Run Plan schemas, serialization, validation) | `ir` |
| `07-plugin` | §17, §24, §26 (plugin contract, capability model, extensions) | `plugin` |
| `08-target-github` | §18.1, §19, §6.1 (GitHub target: analyze/lower/emit, provider mapping) | `target-github` |
| `09-target-gitlab` | §18.2, §19, §6.1 (GitLab target: analyze/lower/emit, provider mapping) | `target-gitlab` |
| `10-engine-native` | §22 (native engine: planner, scheduler, step executor, drivers) | `engine-native` |
| `11-runtime-host` | §22.4 (host process driver) | `runtime-host` |
| `12-runtime-docker` | §22.4 (OCI container driver) | `runtime-docker` |
| `13-planner` | §22.1 component 1 (Run Plan binding: Entry+Trigger+Inputs→Run Plan) | `planner` |
| `14-checks` | derived (ProposedCheck → Step resolution, findings extraction) | `checks` |
| `15-findings` | derived (SARIF normalization, fingerprints, baseline) — **carries over** | `findings` |
| `16-policy` | derived (policy evaluation) — **carries over** | `policy` |
| `17-cli` | §30 (validate, synth, plan, graph, run) | `cli` |
| `18-conformance` | §33 (authoring/target/engine/capability conformance suites) | `tests/` |

Deferred specs (M1+, not in v0 wave plan):
- `19-engine-act` (§23.1), `20-engine-gitlab-ci-local` (§23.2)
- `21-connector-github`, `22-connector-gitlab` (§18.3)
- `23-importer-github`, `24-importer-gitlab` (§20, M2)

## 6. Wave plan (v0)

Each wave: architect (spec + design) → builder (TDD) → reviewer (gates).

### Wave A — Foundation: constructs + Definition Graph model
- Specs: `01-constructs`, `02-definition-graph`, `05-synthesis`
- Packages: `constructs`, `core` (rebuilt)
- Deliverable: `constructs` package wrapping `constructs` lib; `core` defines
  Project/Pipeline/Step/Entry/Trigger/Operation/Reference types; synthesis
  produces a Definition Graph; dependency inference from References; cycle
  detection; validation.
- **Conformance test seed:** the same sample Pipeline authored through
  Construct API synthesizes a canonical graph (spec §33.1, §34.1).

### Wave B — IR: Definition Graph + Run Plan schemas
- Specs: `06-ir`
- Package: `ir` (rebuilt)
- Deliverable: serializable Definition Graph schema (`sverka.dev/v1graph`);
  Run Plan schema (bound graph after Entry+Trigger+Inputs); validation;
  canonical serialization; deterministic IDs.
- Depends on: Wave A.

### Wave C — SDK authoring layer
- Specs: `03-authoring-sdk`
- Package: `sdk` (rebuilt)
- Deliverable: composables (`sh`, `artifact`, `images`, `pipeline`, `parallel`,
  `when`, `matrix`) that build construct trees; typed References; context
  namespaces (`env`, `secrets`, `git`, `change`, `event`, `run`, `inputs`).
- **Conformance:** SDK-authored Pipeline synthesizes same graph as Construct API.
- Depends on: Wave A.

### Wave D — Decorator authoring layer
- Specs: `04-authoring-decorators`
- Package: `decorators` (new)
- Deliverable: `@step`, `@step(options)`, `@entry(trigger)`, `@input`,
  `@output` using standard TC39 decorators (no `experimentalDecorators`);
  metadata registries; method-based planning steps.
- **Conformance:** Decorator-authored Pipeline synthesizes same graph as
  Construct + SDK APIs.
- Depends on: Wave C.

### Wave E — Plugin + capability model
- Specs: `07-plugin`
- Package: `plugin` (new)
- Deliverable: `SverkaPlugin` interface with typed facets; `defineSverkaPlugin`
  factory; `CapabilityManifest` type; capability support levels
  (native/lowered/emulated/connector/partial/unsupported); capability
  analysis producing diagnostics.
- Depends on: Wave B.

### Wave F — Native engine (Run Plan execution)
- Specs: `10-engine-native`, `11-runtime-host`, `12-runtime-docker`
- Packages: `engine-native` (rebuilt from `runtime`), `runtime-host` (adapted),
  `runtime-docker` (adapted)
- Deliverable: engine consumes Run Plan; scheduler runs Step DAG; Step
  executor runs ordered Operations; host + OCI drivers; scalar Output
  transfer; artifact transfer; secret resolution; timeout; cancellation;
  structured run events.
- Depends on: Wave B. Reuses scheduler logic from existing `runtime`.

### Wave G — Planner (Run Plan binding)
- Specs: `13-planner`
- Package: `planner` (rebuilt synthesis, reused discovery)
- Deliverable: binds Entry + Trigger + Inputs + context → Run Plan; project
  discovery (reused from existing planner); proposed-check → Step synthesis.
- Depends on: Wave B, Wave F.

### Wave H — GitHub target (native lowering)
- Specs: `08-target-github`
- Package: `target-github` (rebuilt)
- Deliverable: `analyze(graph) → Diagnostic[]`; `lower(graph) → TargetGraph`;
  `emit(targetGraph) → Artifact[]`; one GitHub job per Step with `needs`,
  `runs-on`, checkout, operation→step mapping, artifact upload/download,
  scalar output via `$GITHUB_OUTPUT`, credential→`secrets` mapping, trigger
  mapping (Push/ChangeRequest/Manual), capability manifest.
- Depends on: Wave B, Wave E.

### Wave I — GitLab target (native lowering)
- Specs: `09-target-gitlab`
- Package: `target-gitlab` (rebuilt)
- Deliverable: same target contract; one GitLab job per Step with `needs`,
  `image`, `rules`, script mapping, artifact passing, variable mapping,
  trigger mapping.
- Depends on: Wave H (shares target contract patterns).

### Wave J — Checks integration
- Specs: `14-checks`
- Package: `checks` (adapted)
- Deliverable: `ProposedCheck → Step` resolution (reuses resolver table);
  `extractFindings` from SARIF (reused); integration with planner + engine.
- Depends on: Wave G, Wave F.

### Wave K — Findings + Policy (carry-over verification)
- Specs: `15-findings`, `16-policy`
- Packages: `findings`, `policy` (unchanged, re-verified against new engine)
- Deliverable: confirm findings extraction works with new engine output;
  policy evaluation works with new finding source.
- Depends on: Wave F, Wave J.

### Wave L — CLI
- Specs: `17-cli`
- Package: `cli` (adapted)
- Deliverable: `sverka validate`, `sverka synth --target github|gitlab`,
  `sverka plan`, `sverka graph`, `sverka run`; updated for Definition Graph
  + Run Plan + targets.
- Depends on: all prior waves.

### Wave M — Conformance suite
- Specs: `18-conformance`
- Deliverable: authoring conformance (3 APIs → same graph); target
  conformance (fixtures per §33.2); engine conformance (fixtures per §33.3);
  capability conformance (manifests match behavior).
- Depends on: all prior waves. This is the §34 acceptance gate.

### Wave N — Docs + website update
- Update `engdocs/user/`, website examples for Construct/SDK/Decorator APIs
  and native target output.
- Depends on: Wave M.

## 7. v0 acceptance criteria (spec §34)

v0 is accepted when:
1. A representative Pipeline can be authored through Constructs, SDK, and Decorators.
2. All three forms synthesize the same normalized Definition Graph.
3. The graph compiles to valid GitHub and GitLab artifacts (native jobs, not wrappers).
4. The same graph executes successfully through the native engine.
5. A scalar Output flows between Steps.
6. An Artifact flows between Steps.
7. A container image is selected provider-neutrally.
8. `env`, `secrets`, `git`, `change`, `event`, `run`, `inputs` are typed symbolic contexts.
9. Cycles and unsupported capabilities produce actionable diagnostics.
10. Target compilation performs no network access.
11. No provider-specific term is required in the portable definition.
12. Generated feature documentation is derived from capability manifests.

## 8. Decisions to supersede

- **ADR-004** (thin wrapper first): **Superseded.** Native lowering is the
  primary target mode for v0. Hosted-engine mode and delegated adapters are
  deferred to M1 per `specs/architecture-spec.md` §31.
- **Spec 00 §94-95** ("thin wrapper first, native later"): **Superseded.**
- **ADR-003** (canonical Plan IR): **Amended.** The flat `Plan` becomes the
  Definition Graph + Run Plan (two schemas, one versioned family).
- **ADR-005** (predecessor reference resolution): **Amended.** Generalized
  from `Operation.after()` to typed References (§11) with automatic
  dependency inference.
- **ADR-006** (SHA-256 content-addressed IDs): **Retained.** Applied to
  Definition Graph node IDs.

## 9. Decisions for v0

1. **`constructs` package version** — Pin `constructs` to an exact version
   (`10.8.1`) in `packages/constructs/package.json` and commit the resulting
   `bun.lock` entry. Verify Bun + ESM + tsdown compatibility during Wave A.
2. **Decorator compiler support** — Standard TC39 stage-3 decorators are
   supported by TypeScript 5.2+ and the Bun transpiler. Use standard decorator
   syntax; avoid `experimentalDecorators`.
3. **Decorator smoke test** — As part of the `decorators` package deliverable,
   add a compile-and-runtime test covering `@step`, `@entry`, `@input`, and
   `@output` with the pinned Bun, TypeScript, and `tsdown` versions. Retain
   `tsc --noEmit` as a separate type-check step because Bun transpilation does
   not type-check.
4. **Existing PRs** — Close the old wave-0–15 feature branches and their
   stacked PRs. Carry over reusable packages (`findings`, `policy`,
   `runtime-host`, `runtime-docker`) into the v0 stack; rebuild the rest as
   v0 waves A–N.
5. **Branch strategy** — Continue the v0 redesign on the existing `v0-*`
   stacked branches (`v0-redesign-foundation` → `v0-a-constructs` → ... →
   `v0-n-docs`). Each wave PR targets the previous wave's branch.
