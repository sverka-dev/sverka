# F-35: Expressions & Contexts — Implementation Plan

**Spec:** `specs/features/F-35-expressions.md`
**Bead:** sv-lfle.18 (P0)
**Blocks:** F-01, F-06, F-11, F-15, F-27, F-28

## Scope

M0 gap: context refs in command strings are not lowered to provider syntax.
Foundation: `expr()` + `Expression` type for M1 expression-dependent features.

Cross-cutting: touches 5 packages (constructs, core, sdk, github, gitlab,
engine-native). No new package. No new external deps.

## Steps (TDD)

### Step 1: Expression type + model updates

**Files:**
- `packages/constructs/src/model.ts` — add `Expression` interface
- `packages/constructs/src/constructs.ts` — `condition?: Reference | Expression`
- `packages/constructs/src/index.ts` — export `Expression`
- `packages/core/src/graph.ts` — `condition?: Reference | Expression`
- `packages/core/src/index.ts` — re-export `Expression`

**Test first:**
- `Expression` interface has `kind: "expression"`, `template: string`, `refs: readonly Reference[]`
- `condition` accepts both `Reference` and `Expression`
- Existing condition tests still pass (backward compat)

### Step 2: expr() tagged template (SDK)

**Files:**
- `packages/sdk/src/expr.ts` — new file
- `packages/sdk/src/index.ts` — export `expr`, `Expression` type
- `packages/sdk/src/sh.ts` — `condition(ref: Reference | Expression)`
- `packages/sdk/src/when.ts` — accept `Reference | Expression`

**Test first:**
- `expr`${git.branch}`` → `{ kind: "expression", template: "${git.branch}", refs: [gitRef] }`
- `expr`${git.branch} == "main"`` → template includes `== "main"`, refs has 1
- `expr`build-${git.sha}`` → template `build-${git.sha}`, refs has 1
- String/number/boolean values inlined into template
- Non-Reference/non-primitive value throws `SdkError`

### Step 3: GitHub target — context ref + step ref translation in commands

**Files:**
- `packages/github/src/lower.ts` — add `translateCommand()`, context table, apply in `lowerOperation`
- `packages/github/src/types.ts` — add `if` field to `GithubJob`/`GithubStep` if needed

**Test first:**
- `sh\`deploy ${git.branch}\`` → `run: deploy ${{ github.ref_name }}`
- `sh\`echo ${git.sha}\`` → `run: echo ${{ github.sha }}`
- `sh\`deploy ${env.MY_VAR}\`` → `run: deploy ${{ env.MY_VAR }}`
- `sh\`deploy ${build.version}\`` → `run: deploy ${{ steps.build.outputs.version }}`
- `sh\`echo ${HOME}\`` (literal, no ref in inputs) → `run: echo ${HOME}` (unchanged)

### Step 4: GitHub target — condition lowering

**Files:**
- `packages/github/src/lower.ts` — add `lowerCondition()`, apply in `lowerStep`
- `packages/github/src/types.ts` — add `if?: string` to `GithubJob`

**Test first:**
- `condition: expr`${git.branch} == "main"`` → `if: ${{ github.ref_name == "main" }}`
- `condition: git.branch` (Reference) → `if: ${{ github.ref_name }}`
- No condition → no `if` field

### Step 5: GitLab target — context ref + step ref translation in commands

**Files:**
- `packages/gitlab/src/lower.ts` — add `translateCommand()`, context table, apply in `lowerOperations`

**Test first:**
- `sh\`deploy ${git.branch}\`` → `script: deploy $CI_COMMIT_BRANCH`
- `sh\`echo ${git.sha}\`` → `script: echo $CI_COMMIT_SHA`
- `sh\`deploy ${env.MY_VAR}\`` → `script: deploy $MY_VAR`
- `sh\`deploy ${build.version}\`` → `script: deploy $version`
- `sh\`echo ${HOME}\`` (literal) → `script: echo ${HOME}` (unchanged)

### Step 6: GitLab target — condition lowering

**Files:**
- `packages/gitlab/src/lower.ts` — add `lowerCondition()`, apply in `lowerStep`
- `packages/gitlab/src/types.ts` — add `rules?` to GitlabJob if needed

**Test first:**
- `condition: expr`${git.branch} == "main"`` → `rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }]`
- `condition: git.branch` (Reference) → `rules: [{ if: '$CI_COMMIT_BRANCH' }]`
- No condition → no `rules` field

### Step 7: Native engine — context ref resolution in commands

**Files:**
- `packages/engine-native/src/step-executor.ts` — extend `interpolateCommand` with context ref resolution

**Test first:**
- `env.MY_VAR` resolved from `process.env.MY_VAR`
- `git.sha` resolved from git rev-parse HEAD
- `git.branch` resolved from git rev-parse --abbrev-ref HEAD
- `inputs.X` resolved from pipeline inputs
- Unresolved context ref throws `StepExecError`

**Implemented (M0):** Expression condition evaluation in `evaluateCondition`.
Native `Expression` conditions are evaluated by the engine and covered by tests
in `packages/engine-native/src/__tests__/engine.test.ts`. `Reference` conditions
are also handled. Context ref resolution in command strings is lowered to
provider-specific syntax by both GitHub and GitLab targets.

### Step 8: Full monorepo gate

- `bun run test` — all packages green
- `bun run typecheck` — 0 errors
- `bun run lint` — 0 errors
- `bun run build` — all packages build

## Implementation notes

- The `translateCommand` function is per-target (not shared) because the
  output syntax differs fundamentally. The tables are small (~15 entries).
- Step ref resolution in targets needs the `jobIdMap` (GitHub) or just the
  output name (GitLab). The step's `inputs` array identifies which `${...}`
  are refs vs literal shell variables.
- The native engine's expression evaluation is intentionally minimal: `==`
  and `!=` comparisons with string/number/boolean literals. No `&&`/`||`
  parser — that's M1 scope (F-11 conditions). For M0, single comparisons
  suffice.
- `run.attempt` has no GitLab equivalent. Left as `$run_attempt` — the
  variable will be empty in GitLab, which is harmless.

## Commit hygiene

Stage only files in the 5 affected packages + the spec + this plan.
Exclude city.toml, agents/, .devin/, .gc/, .beads/, formulas/.
