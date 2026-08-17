# Feature: Expressions & contexts

**ID:** F-35
**Category:** expressions
**Milestone:** M0 (already in v0, partial)
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

Expressions allow dynamic values in pipeline configuration — referencing git context, environment variables, step outputs, and more. GitHub uses `${{ }}` with contexts (github, env, secrets, inputs, steps, needs, matrix, job, runner). GitLab uses `$CI_*` predefined variables and `$[[ ]]` for input interpolation. Sverka needs its own expression layer that lowers to both.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `${{ }}` + contexts | `$CI_*` vars + `$[[ ]]` | `expr()` template literal |
| Semantics | Evaluate expression in context | Variable interpolation + input interpolation | Portable expression evaluation |
| Value type | expression string | variable reference | expression string |
| Limitations | GitHub-specific syntax | GitLab-specific variables | translation needed |
| Provider gap | — | — | — |

## GitHub Actions

```yaml
env:
  BRANCH: ${{ github.ref }}
  VERSION: ${{ steps.build.outputs.version }}
  DEPLOY: ${{ github.ref == 'refs/heads/main' && 'true' || 'false' }}
```

Contexts: `github`, `env`, `secrets`, `inputs`, `steps`, `needs`, `strategy`, `matrix`, `job`, `runner`, `vars`.
Functions: `always()`, `cancelled()`, `failure()`, `success()`, `hashFiles()`, `format()`, `toJSON()`, `fromJSON()`, `contains()`, `startsWith()`, `endsWith()`, `join()`.

## GitLab CI

```yaml
variables:
  BRANCH: $CI_COMMIT_BRANCH
  VERSION: $BUILD_VERSION
deploy:
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
  script: deploy
```

Predefined variables: `$CI_COMMIT_BRANCH`, `$CI_COMMIT_TAG`, `$CI_PIPELINE_SOURCE`, `$CI_MERGE_REQUEST_TARGET_BRANCH_NAME`, `$CI_JOB_NAME`, `$CI_PROJECT_DIR`, and hundreds more. `$[[ ]]` for input interpolation in included configs.

## Sverka proposal

### Portable model

Sverka uses tagged template `expr()` for expressions with typed context namespaces:

```ts
// Context namespaces
const env = context.env;        // environment variables
const secrets = context.secrets; // secrets
const git = context.git;        // git context (branch, tag, ref, sha)
const change = context.change;  // PR/MR context
const event = context.event;    // event context
const run = context.run;        // run context
const inputs = context.inputs;  // workflow inputs
const steps = context.steps;    // step outputs
const needs = context.needs;    // dependency outputs
```

### Authoring API

```ts
// SDK
task("deploy", {
  run: sh`deploy ${expr`${git.branch}`}`,
  condition: { expression: expr`${git.branch} == "main"` },
}),

// Using context namespaces directly
task("deploy", {
  run: sh`deploy ${git.branch}`,
}),
```

### Lowering

- **GitHub target:** `expr`${git.branch}`` → `${{ github.ref }}`. `expr`${inputs.env}`` → `${{ inputs.env }}`. `expr`${needs.build.outputs.version}`` → `${{ needs.build.outputs.version }}`. Function calls translated: `hashFiles()` → `hashFiles()`, `success()` → `success()`.
- **GitLab target:** `expr`${git.branch}`` → `$CI_COMMIT_BRANCH`. `expr`${inputs.env}`` → `$[[ inputs.env ]]`. `expr`${needs.build.outputs.version}`` → `$version` (from dotenv artifact). Function calls translated where possible; unsupported functions emit warnings.
- **Native engine:** evaluate expressions against the runtime context object. Git context from current repo state. Step outputs from ValueStore.

### Capability manifest

```ts
"expressions.context": "native",
"expressions.functions": "partial",   // some functions provider-specific
```

### Portability & divergence

This is the most complex portability surface. GitHub and GitLab have completely different expression syntaxes and context models. Sverka defines its own context namespaces (`git`, `change`, `event`, `run`, `inputs`, `steps`, `needs`, `env`, `secrets`) and translates to provider-specific syntax during lowering. Some functions (`hashFiles()`) may not have GitLab equivalents.

## Implementation design

### Expression type (constructs/model.ts)

```ts
export interface Expression {
  readonly kind: "expression";
  readonly template: string;              // e.g. '${git.branch} == "main"'
  readonly refs: readonly Reference[];    // collected references for dep inference
}
```

Minimal: 3 fields. `template` uses the same `${namespace.field}` placeholder
format as `sh()` command strings. `refs` tracks references for dependency
inference and target translation.

### expr() tagged template (sdk)

```ts
export function expr(
  strings: TemplateStringsArray,
  ...values: readonly (string | number | boolean | Reference)[]
): Expression
```

Same interpolation pattern as `sh()`: string/number/boolean values are
inlined; Reference values produce `${namespace.field}` placeholders and are
collected into `refs`. Returns an `Expression`.

### Condition model update

`condition?: Reference` → `condition?: Reference | Expression` in:
- `constructs.ts` StepProps + Step
- `core/graph.ts` StepDefinition
- `sdk/sh.ts` StepBuilder.condition()

Backward-compatible: existing `Reference` conditions still work. New
`Expression` conditions enable comparisons (`expr`${git.branch} == "main"``).

### Context ref translation tables

Each target owns its own table. Well-known fields are mapped explicitly;
dynamic namespaces (env, secrets, inputs) use a prefix rule.

**GitHub:**

| namespace.field | GitHub context ref |
|-----------------|--------------------|
| git.sha | github.sha |
| git.branch | github.ref_name |
| git.tag | github.ref_name |
| change.id | github.event.pull_request.number |
| change.source | github.event_name |
| change.target | github.base_ref |
| change.draft | github.event.pull_request.draft |
| event.type | github.event_name |
| run.id | github.run_id |
| run.attempt | github.run_attempt |
| env.X | env.X |
| secrets.X | secrets.X |
| inputs.X | inputs.X |

Step refs: `${step.output}` → `${{ steps.<jobId>.outputs.<output> }}`

**GitLab:**

| namespace.field | GitLab variable |
|-----------------|-----------------|
| git.sha | CI_COMMIT_SHA |
| git.branch | CI_COMMIT_BRANCH |
| git.tag | CI_COMMIT_TAG |
| change.id | CI_MERGE_REQUEST_IID |
| change.source | CI_PIPELINE_SOURCE |
| change.target | CI_MERGE_REQUEST_TARGET_BRANCH_NAME |
| change.draft | CI_MERGE_REQUEST_DRAFT |
| event.type | CI_PIPELINE_SOURCE |
| run.id | CI_PIPELINE_ID |
| run.attempt | (no equivalent — left as $run_attempt) |
| env.X | X |
| secrets.X | X |
| inputs.X | X |

Step refs: `${step.output}` → `$<output>` (from dotenv artifact)

### Command string translation (both targets)

Parse `${...}` placeholders in command strings. For each placeholder:
1. Match against the step's `inputs` array (ContextRef or StepRef)
2. If context ref → replace with provider context syntax
3. If step ref → replace with provider step output syntax (using jobIdMap)
4. If no match → leave as-is (literal shell variable)

This reuses the existing `inputs` array — no new data structures needed.

### Expression lowering (both targets)

For `Expression` conditions:
- **GitHub:** translate each `${X}` to the GitHub context ref (e.g.
  `github.ref_name`), then wrap the whole expression in `${{ }}`.
  `if: ${{ github.ref_name == "main" }}`
- **GitLab:** translate each `${X}` to the GitLab variable (e.g.
  `$CI_COMMIT_BRANCH`). No wrapping needed.
  `rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }]`

For `Reference` conditions (backward compat):
- **GitHub:** `if: ${{ <context_ref> }}` (truthiness check)
- **GitLab:** `rules: [{ if: '<variable>' }]` (truthiness check)

### Native engine context ref resolution

Extend `interpolateCommand` in `step-executor.ts` to resolve context refs
before trying step outputs:
- `env.X` → `process.env.X`
- `secrets.X` → from secret provider
- `git.sha` → from git state (rev-parse HEAD)
- `git.branch` → from git state (rev-parse --abbrev-ref HEAD)
- `git.tag` → from git state (describe --tags --exact-match 2>/dev/null)
- `inputs.X` → from pipeline inputs
- `change.*`, `event.*`, `run.*` → from run context (if available)

Expression condition evaluation in `evaluateCondition` is deferred to M1
(F-11 conditions). For M0, only context ref resolution in command strings
is needed. `evaluateCondition` already handles `Reference` conditions.

## Non-goals

- Custom user-defined functions.
- Expression evaluation in the Definition Graph (deferred to runtime).
- Full compatibility with all GitHub/GitLab expression features.
- `hashFiles()` or other provider-specific functions.
- Expression composition (`expr`${expr`...`}``).

## Dependencies

- **Depends on:** none.
- **Blocks:** F-01 (runName), F-06 (filters), F-11 (conditions), F-15 (matrix), F-27 (cache), F-28 (concurrency) — all use expressions.

## Test plan

1. `expr()` produces correct `Expression` (template + refs)
2. `expr()` rejects non-Reference/non-primitive interpolation values
3. GitHub: context refs in command strings translated to `${{ }}` syntax
4. GitHub: step refs in command strings translated to `${{ steps.*.outputs.* }}`
5. GitHub: Expression conditions lowered to `if: ${{ ... }}`
6. GitHub: Reference conditions lowered to `if: ${{ ... }}` (truthiness)
7. GitLab: context refs in command strings translated to `$CI_*` variables
8. GitLab: step refs in command strings translated to `$<output>` variables
9. GitLab: Expression conditions lowered to `rules: [{ if: ... }]`
10. GitLab: Reference conditions lowered to `rules: [{ if: ... }]` (truthiness)
11. Native engine: `env.X` resolved from `process.env`
12. Native engine: `git.sha/branch/tag` resolved from git state
13. Native engine: `inputs.X` resolved from pipeline inputs
14. Unresolved `${...}` in commands left as-is (literal shell variables)
15. `condition?: Reference | Expression` backward-compatible (existing tests pass)

## References

- GitHub: https://docs.github.com/en/actions/learn-github-actions/contexts
- GitHub: https://docs.github.com/en/actions/learn-github-actions/expressions
- GitLab: https://docs.gitlab.com/ee/ci/variables/
- GitLab: https://docs.gitlab.com/ee/ci/expressions.html
- Architecture spec: §11, §12.3, §25, §31.2
