# F-31: Reusable Workflows & Pipelines — Implementation Plan

**Spec:** `specs/features/F-31-reusable-workflows.md`
**Bead:** sv-lfle.40 (P3, M2)
**Depends on:** F-47 (typed inputs) — **WEAK dependency, see decision D6.** F-31 ships
without F-47's extended type validators; it uses the existing `Input` model.
**Blocks:** F-32 (components), F-33 (child pipelines), F-34 (downstream projects).

## Scope

Add pipeline-to-pipeline composition within a single Project: a pipeline can be
invoked as a step inside another pipeline, with bound inputs and propagated
outputs. Lower to GitHub reusable workflows (`workflow_call` + `uses`) and
inline callee steps in GitLab (v1; `include:` file reuse deferred). Inline in
the native engine.

Cross-cutting: touches 7 packages (constructs, core, sdk, planner, github,
gitlab, conformance). No new external deps. Engine-native is **unchanged**.

## Design decisions (resolves spec Open Questions)

**D1 — Inline vs. reference in IR.** The Definition Graph keeps the call as a
**reference** (`StepDefinition.call: PipelineCall`), preserving the call
boundary so targets can emit separate reusable files. The planner expands call
steps into a flat `StepDefinition[]` (`expandPipelineCalls`) for the native
engine. The engine sees only flat steps — **no engine changes**.

**D2 — Outputs propagation.** At synthesis, the callee pipeline's
`PipelineOutputDefinition[]` are copied onto the call step's `outputs`
(producer = call step id). Downstream caller steps reference them via the
existing `StepRef` mechanism. No new reference type.

**D3 — Nesting depth.** `MAX_PIPELINE_CALL_DEPTH = 4` (matches GitHub's
hard limit). Synthesis rejects deeper chains. Hardcoded constant in core.

**D4 — GitLab lowering.** **v1 inlines** callee steps as namespaced jobs in
`.gitlab-ci.yml` (reuses `expandPipelineCalls`). Rationale: GitLab `include:`
+ `spec:inputs` cannot namespace job names per call-site, so true file-reuse
across multiple call sites of the same callee produces job-name collisions.
Inlining preserves the runtime semantics (same-context execution, which is
what `include:` merge does too) — §5.6 governs behavior, not file layout.
`include:` (true file reuse) and `trigger:include` (separate-context child
pipelines) are **deferred** — file-reuse to a follow-up bead, `trigger:include`
to F-33.

**D5 — GitHub lowering.** GitHub has no inline option — reusable workflows are
always separate files. Callee → separate workflow file with
`on: workflow_call` + `inputs`. Call site → job with
`uses: ./.github/workflows/<callee>.yml`, `with:` (bound inputs),
`secrets: inherit`. GitHub handles per-call-site namespacing via the calling
job's id, so one callee file serves N call sites (unlike GitLab).

**D6 — F-47 dependency is weak.** F-31 needs the *plumbing* (declare inputs on
a pipeline — already exists; bind inputs at call site — new; propagate outputs
— new). It does NOT need F-47's extended type validators (`choice`/`array`/
`pattern`/`options`). F-31 uses the existing `Input` (`string`|`number`|
`boolean` + required/default/description/secret). F-47 enhances `Input` later;
F-31's synthesis validates only: required inputs are bound, literal types
match the declared `Input.type`. Flagged to mayor.

**D7 — Callable pipelines.** Any pipeline in the Project is callable. A
pipeline **with entries** is a root (emitted as a root workflow / part of
`.gitlab-ci.yml` with its triggers). A pipeline **referenced by a call step**
gets `workflow_call` added (GitHub) / is inlined (GitLab). A pipeline can be
**both** a root and a callee (GitHub allows `workflow_call` + `push` on one
workflow). No "single main pipeline" constraint — each pipeline with entries
is a root.

**D8 — Call-step identity.** A call step has its own id (e.g. `deploy-staging`)
distinct from the callee pipeline id (e.g. `deploy`). This allows calling the
same callee twice with different inputs.

## Portable model

```ts
// constructs/model.ts
export type InputLiteral = string | number | boolean;

// core/graph.ts
export interface PipelineCall {
  readonly callee: string;                              // callee pipeline id
  readonly inputs: Readonly<Record<string, Reference | InputLiteral>>;
}
export interface StepDefinition {
  // ...existing fields...
  readonly call?: PipelineCall;                         // present ⇒ pipeline-call step
}
```

A step with `call` has no shell operations. Its `outputs` are the callee's
pipeline outputs (copied at synthesis, producer = call step id).

## Authoring API (SDK)

```ts
// packages/sdk/src/call.ts (new)
export interface CallBuilder {
  inputs(inputs: Readonly<Record<string, Reference | InputLiteral>>): CallBuilder;
  build(pipeline: Pipeline, id: string): PipelineCallStep;
}
export function callPipeline(callee: string): CallBuilder;

// usage
pipeline(project, "ci", {
  steps: [
    (p) => sh`make build`.build(p, "build"),
    (p) => callPipeline("deploy").inputs({ env: inputs.environment }).build(p, "deploy-staging"),
  ],
  entries: [(p) => entry(p, "on-push", { trigger: push(), roots: ["build", "deploy-staging"] })],
});
pipeline(project, "deploy", {
  inputs: { env: { type: "string", required: true } },
  steps: [(p) => sh`deploy ${inputs.env}`.build(p, "deploy")],
});
```

## Steps (TDD)

### Step 1: constructs — PipelineCallStep + InputLiteral

**Files:**
- `packages/constructs/src/model.ts` — add `InputLiteral = string | number | boolean`
- `packages/constructs/src/constructs.ts` — add `PipelineCallStepProps` (`callee`,
  `callInputs`) + `PipelineCallStep extends Step` (stores `callee`, `callInputs`;
  no shell command). Reuse `StepProps` for runtime/outputs/dependsOn/timeout/condition.
- `packages/constructs/src/index.ts` — export `PipelineCallStep`, `PipelineCallStepProps`,
  `InputLiteral`

**Test first (`packages/constructs/src/__tests__/constructs.test.ts`):**
- `PipelineCallStep` constructed under a Pipeline stores `callee` + `callInputs`
- Inherits `Step` invariants (INVALID_SCOPE if not under Pipeline, DUPLICATE_ID)
- `InputLiteral` accepts string/number/boolean

### Step 2: core graph — PipelineCall field + types

**Files:**
- `packages/core/src/graph.ts` — add `PipelineCall` interface; `StepDefinition.call?`
- `packages/core/src/index.ts` — re-export `PipelineCall`, `InputLiteral`

**Test first (`packages/core/src/__tests__/graph.test.ts` or new `call.test.ts`):**
- `StepDefinition` with `call` round-trips through serialization
- `PipelineCall.inputs` accepts `Reference` and `InputLiteral` values

### Step 3: core synthesize — two-pass: synthesize all pipelines, then resolve calls

**Files:**
- `packages/core/src/synthesize.ts`:
  - **Two-pass** (callee may be defined after the caller in the tree):
    - Pass 1: synthesize each pipeline's steps/entries/outputs WITHOUT
      resolving call steps (call steps get `call` set but `outputs` deferred).
    - Pass 2: for each call step, look up the callee pipeline (by id across
      the whole Project), copy the callee's `PipelineOutputDefinition[]` onto
      the call step's `outputs` (producer = call step id), then run
      `validatePipelineCalls`.
  - `synthesizeStep`: if `step instanceof PipelineCallStep`, set `call`, emit
    NO shell operations. Outputs resolved in pass 2.
  - New `validatePipelineCalls(project, pipelines)`:
    - callee exists in Project (else `SynthesisError(UNKNOWN_CALLEE)`)
    - every required callee input is bound (else `MISSING_INPUT_BINDING`)
    - literal binding type matches `Input.type` (else `INPUT_TYPE_MISMATCH`)
    - no binding to an undeclared callee input (else `UNKNOWN_INPUT`)
    - call graph acyclic across pipelines (else `CALL_CYCLE`)
    - call depth ≤ `MAX_PIPELINE_CALL_DEPTH` (else `NESTING_TOO_DEEP`)
- `packages/core/src/errors.ts` — new `SynthesisErrorCode` values:
  `UNKNOWN_CALLEE`, `MISSING_INPUT_BINDING`, `INPUT_TYPE_MISMATCH`,
  `UNKNOWN_INPUT`, `CALL_CYCLE`, `NESTING_TOO_DEEP`
- `packages/core/src/validate.ts` (or new `validate-calls.ts`) — call-graph
  cycle + depth check (pipeline-level DFS, not step-level)

**Test first (`packages/core/src/__tests__/synthesize.test.ts` + new `calls.test.ts`):**
- Two-pipeline project: `ci` calls `deploy`; graph has 2 pipelines; call step
  has `call` + callee's outputs copied (regardless of declaration order —
  test callee defined both before AND after caller)
- Missing required input binding → `MISSING_INPUT_BINDING`
- Unknown callee → `UNKNOWN_CALLEE`
- Literal type mismatch (number bound to string input) → `INPUT_TYPE_MISMATCH`
- Call cycle (A calls B, B calls A) → `CALL_CYCLE`
- Depth 5 chain → `NESTING_TOO_DEEP`; depth 4 chain → OK
- Pipeline with entries AND called by another → both root triggers and
  `workflow_call` applicability preserved (graph has the entries; target
  lowering decides triggers)
- Existing single-pipeline synthesis still passes (backward compat)

### Step 4: core — expandPipelineCalls (pure graph transform for the engine path)

**Files:**
- `packages/core/src/expand-calls.ts` (new):
  ```ts
  export function expandPipelineCalls(
    graph: DefinitionGraph,
    steps: readonly StepDefinition[],
  ): readonly StepDefinition[];
  ```
  - For each call step: recursively expand the callee's steps with id prefix
    `<callStepId>/` (so callee step `deploy` becomes `ci/deploy-staging/deploy`).
  - Rewrite callee-internal `StepRef`s, `dependsOn`, `importArtifact.from`,
    `condition` to namespaced ids.
  - Bind callee `inputs.X` context refs → the call site's bound value/ref
    (literal → keep; `Reference` → substitute into the expanded step's
    `inputs`/`condition`/`importArtifact`).
  - The call step itself is replaced by the expanded callee steps; its
    `dependsOn`/`condition` propagate to the callee's root steps; downstream
    caller steps that referenced the call step's outputs now reference the
    callee's producing steps' outputs (rewrite those refs in the caller too).
  - Cycle/depth already validated at synthesis; expansion assumes valid graph.
- `packages/core/src/index.ts` — export `expandPipelineCalls`

**Test first (`packages/core/src/__tests__/expand-calls.test.ts`):**
- `ci` calls `deploy` (1 step); expansion yields `ci/build`, `ci/deploy-staging/deploy`
- Callee `inputs.env` bound to caller literal `"staging"` → expanded step has
  no `inputs.env` ref (literal substituted into command via the existing
  expression mechanism — verify the bound value reaches the operation)
- Callee `inputs.env` bound to caller `StepRef(build, version)` → expanded
  callee step depends on `ci/build`
- Downstream caller step referencing call step output → rewritten to the
  callee's producing step
- Nested calls (A calls B calls C) → fully flattened, depth-3 ids
- Expansion of a graph with no calls → identity

**⚠ Risk area:** rewriting downstream caller `StepRef`s that pointed at the
call step's outputs to point at the callee's actual producing steps (after
namespacing) is the most intricate logic in this feature. The builder must
handle: (a) caller step references `callStepId/out` → rewrite to
`<callStepId>/<calleeProducerStepId>/out`; (b) callee-internal refs →
namespaced; (c) the call step's own `dependsOn`/`condition` propagate to the
callee's root steps. If this proves brittle, fall back to a simpler model
where the call step's outputs are materialized as explicit
`exportOutput`/`exportArtifact` ops on a synthetic "call boundary" step.

### Step 5: planner — bindRunPlan expands calls

**Files:**
- `packages/planner/src/bind.ts` — after `computeReachableSteps`, call
  `expandPipelineCalls(graph, reachableSteps)` before building the `RunPlan`.
  Bound user inputs (top-level pipeline inputs) flow as today; call-site
  bindings are resolved inside `expandPipelineCalls`.
- No `RunPlan` schema change (still `steps: StepDefinition[]`, now flat-expanded).

**Test first (`packages/planner/src/__tests__/bind.test.ts`):**
- Bind a graph with a call step → RunPlan.steps is the expanded flat list
- RunPlan id is deterministic for the same graph + entry + inputs
- Existing single-pipeline bind tests still pass

### Step 6: SDK — callPipeline builder

**Files:**
- `packages/sdk/src/call.ts` (new) — `callPipeline(callee): CallBuilder` with
  `.inputs(...)` + `.build(pipeline, id)` → `new PipelineCallStep(pipeline, id, { callee, callInputs, ... })`
- `packages/sdk/src/index.ts` — export `callPipeline`, `CallBuilder`,
  `PipelineCallStep`, `PipelineCallStepProps` (re-export from constructs)

**Test first (`packages/sdk/src/__tests__/call.test.ts`):**
- `callPipeline("deploy").inputs({ env: "staging" }).build(p, "deploy-staging")`
  produces a `PipelineCallStep` with correct callee + callInputs
- `callPipeline("deploy").build(p, "d")` with no inputs → empty callInputs
- Interpolation: `inputs.env` (a `ContextRef`) accepted as a binding value

### Step 7: GitHub target — separate reusable workflow file + uses job

**Files:**
- `packages/github/src/lower.ts`:
  - Lift the `multi-pipeline` rejection. Emit one workflow file per pipeline
    that has entries OR is referenced by a call step:
    - Pipeline with entries → root workflow with `on: <its triggers>`. If it is
      ALSO called by another pipeline, add `workflow_call` to its `on:`.
    - Pipeline referenced by a call step but with NO entries → reusable-only
      workflow with `on: { workflow_call: { inputs } }`.
  - Callee `Input` → `inputs` block (`{ type, required, default, description }`;
    `secret: true` → `secrets` block, not `inputs`). Jobs = callee's reachable
    steps (all steps reachable in a reusable workflow — no entries needed).
  - Call step in a root pipeline → `GithubJob` with `steps: [{ uses:
    "./.github/workflows/<callee>.yml", with: <bound inputs>, secrets: "inherit" }]`,
    `needs:` from the call step's dependencies.
- `packages/github/src/emit.ts` — emit one `GeneratedArtifact` per target graph
  (`.github/workflows/<pipelineId>.yml` each). Return `CompilationResult` with
  all artifacts.
- `packages/github/src/types.ts` — `GithubTriggers` add `workflow_call?:
  { inputs?: Record<string, ...>; secrets?: Record<string, ...> }` (or
  `workflow_call: null` for no-input case). `GithubStep` already has `uses`/`with`.
- `packages/github/src/capabilities.ts` — add `"reusable.pipeline": "native"`,
  `"reusable.pipeline.inputs": "native"`, `"reusable.pipeline.outputs": "native"`.

**Test first (`packages/github/src/__tests__/target.test.ts`):**
- Two-pipeline graph (ci with entries calls deploy with no entries) → 2
  artifacts: `ci.yml` (on: push) + `deploy.yml` (on: workflow_call + inputs)
- `deploy.yml` has `on: workflow_call` + `inputs` from callee's `Input`s
- `ci.yml` call job has `uses: ./.github/workflows/deploy.yml` + `with:` +
  `secrets: inherit`; `needs:` from call step deps
- Pipeline with entries AND called by another → root workflow with BOTH
  `on: push` and `on: workflow_call`
- Bound literal → `with:` value; bound `StepRef` →
  `${{ needs.<producer>.outputs.<name> }}`
- Single-pipeline graph (no calls) → unchanged output (backward compat)

### Step 8: GitLab target — inline callee steps (v1)

**Files:**
- `packages/gitlab/src/lower.ts`:
  - Lift the `multi-pipeline` rejection. For each root pipeline (has entries),
    call `expandPipelineCalls(graph, reachableSteps)` to inline call steps into
    namespaced jobs, then lower the flat step list as today (one job per step,
    stages from topo levels, rules from entries).
  - No `include:`, no `spec:inputs`, no separate callee files in v1. The
    callee's steps appear as namespaced jobs (`<callStepId>/<calleeStepId>`)
    in `.gitlab-ci.yml`. Runtime semantics (same-context execution) match
    GitLab `include:` merge.
- `packages/gitlab/src/emit.ts` — unchanged (still one `.gitlab-ci.yml`).
- `packages/gitlab/src/capabilities.ts` — add `"reusable.pipeline": "lowered"`
  (inlined, not a separate file), `"reusable.pipeline.inputs": "native"`,
  `"reusable.pipeline.outputs": "native"`.

**Test first (`packages/gitlab/src/__tests__/target.test.ts`):**
- Two-pipeline graph (ci calls deploy) → ONE `.gitlab-ci.yml` with namespaced
  jobs `ci/build`, `ci/deploy-staging/deploy`; no `include:` key
- Callee `inputs.env` bound to literal → substituted into the inlined job's
  script (via the existing expression-lowering path)
- Callee `inputs.env` bound to caller `StepRef(build, version)` → inlined job
  `needs: [ci/build]` + dotenv scalar mechanism
- Single-pipeline graph (no calls) → unchanged output (backward compat)
- **Follow-up bead (out of scope):** `include:` + `spec:inputs` true file reuse

### Step 9: conformance — reusable pipeline fixture across 3 authoring surfaces

**Files:**
- `packages/conformance/src/seed.ts` — add a reusable-pipeline seed: a `deploy`
  pipeline (callable, 1 input, 1 step, 1 output) called from a `ci` pipeline
  (build → deploy-staging). Authored via Construct, SDK, Decorator → must
  synthesize equivalent graphs (call step present, callee outputs copied).
- `packages/conformance/src/__tests__/conformance.test.ts` — assert:
  - 3 surfaces produce equal graphs (JSON equality of normalized graph)
  - `expandPipelineCalls` flattens to the same step list as a hand-written
    inline equivalent
  - GitHub lowering emits 2 artifacts; GitLab emits 2 artifacts
  - Native engine runs the expanded plan end-to-end (build → deploy)

**Test first:**
- Seed + assertions before impl (impl lands in steps 1-8; this step verifies
  integration). Write the expected-graph fixture first.

### Step 10: docs + capability manifest + spec Open Questions resolution

**Files:**
- `specs/features/F-31-reusable-workflows.md` — fill Open Questions with D1-D8
- `engdocs/user/` — add a reusable-workflows section to `workflow-api/overview.md`
  (or a new page) showing `callPipeline` usage + GitHub/GitLab lowering output
- `packages/plugin/src/` — if capability manifest is centralized, register
  `reusable.pipeline*` keys (verify where the canonical manifest lives; if
  per-target, steps 7-8 already cover it)

## Non-goals (this wave)

- Cross-repository workflow calls (F-34).
- Dynamic child pipelines / `trigger:include` (F-33).
- Reusable components / composite actions (F-32 — different unit).
- F-47 extended input types (`choice`/`array`/`pattern`/`options`) — F-31 uses
  existing `Input`. F-47 enhances validation later.
- Configurable nesting depth (hardcoded 4).
- GitLab `include:` + `spec:inputs` true file reuse — v1 inlines; file reuse
  is a follow-up bead (job-name collision across multiple call sites of the
  same callee has no clean GitLab-native solution without per-call-site files).

## Verification gates

- `bun run test` green for all 7 touched packages + full monorepo
- `bun run typecheck` / `bun run lint` / `bun run build` green
- No `any` in impl (grep confirmed)
- Conformance: 3-surface graph equality holds; engine runs the expanded plan

## Commit hygiene

Stage only the touched package dirs + this plan + the F-31 spec edit + any
`engdocs/user/` doc edits + `bun.lock` (if deps change — none expected).
EXCLUDE `city.toml`/`agents/`/`.devin/`/`.gc/`/`.beads/`/`.evidence/`/`.opencode/`/`formulas/`.
