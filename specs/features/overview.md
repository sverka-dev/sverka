# Sverka Feature Matrix & Mini-Spec Overview

**Parent epic:** sv-4wh9
**Scope:** Full surface area of GitHub Actions workflow syntax and GitLab CI YAML,
mapped to proposed Sverka portable constructs.
**Status:** All specs are **Proposed** — awaiting review.

## How to read this

Each row below is one feature. Each feature has its own mini-spec file
(`F-NN-slug.md`) following the shared template (`_template.md`). The
mini-spec contains the provider matrix, GitHub/GitLab details, the proposed
Sverka portable model, authoring API, lowering rules, capability manifest,
and open questions.

**Milestone legend:** M0 = already in v0 scope · M1 = next · M2 = later · M3 = vision

**Sverka status legend:** ✓ covered (in 08/09 specs) · ✗ deferred (§32) · ➜ proposed (new)

## Full feature matrix

| ID  | Feature | Category | Milestone | GitHub Actions | GitLab CI | Sverka status | Spec |
|-----|---------|----------|-----------|----------------|-----------|---------------|------|
| F-01 | Workflow naming & run name | workflow-control | M0 | `name`, `run-name` | `workflow:name` | ✓ partial | [spec](F-01-naming.md) |
| F-02 | Push trigger | triggers | M0 | `on: push` | `rules: if $CI_PIPELINE_SOURCE == "push"` | ✓ | [spec](F-02-trigger-push.md) |
| F-03 | Change request trigger | triggers | M0 | `on: pull_request` | `rules: if merge_request_event` | ✓ | [spec](F-03-trigger-change-request.md) |
| F-04 | Manual trigger | triggers | M0 | `on: workflow_dispatch` | `when: manual` + `rules` | ✓ | [spec](F-04-trigger-manual.md) |
| F-05 | Schedule trigger | triggers | M1 | `on: schedule` (cron) | scheduled pipelines (API) | ✗ deferred | [spec](F-05-trigger-schedule.md) |
| F-06 | Branch, tag & path filters | triggers | M0 | `branches`, `tags`, `paths` (+ `-ignore`) | `rules:changes`, `rules:if` branch refs | ✓ partial | [spec](F-06-filters.md) |
| F-07 | Step DAG & dependencies | scheduling | M0 | `jobs.<id>.needs` | `needs` | ✓ | [spec](F-07-dag-dependencies.md) |
| F-08 | Stages & ordering | scheduling | M0 | implicit via `needs` | `stages` + topological level | ✓ | [spec](F-08-stages.md) |
| F-09 | Shell operations | execution | M0 | `steps[*].run` | `script` | ✓ | [spec](F-09-shell-operations.md) |
| F-10 | Before/after script | execution | M1 | `defaults.run` (partial) | `before_script`, `after_script` | ✗ deferred | [spec](F-10-before-after-script.md) |
| F-11 | Step & job conditions | scheduling | M1 | `steps[*].if`, `jobs.<id>.if` | `rules:if`, `rules:when` | ✗ deferred | [spec](F-11-conditions.md) |
| F-12 | Continue-on-error / allow-failure | scheduling | M1 | `continue-on-error` | `allow_failure`, `allow_failure:exit_codes` | ✗ deferred | [spec](F-12-continue-on-error.md) |
| F-13 | Timeout | execution | M0 | `timeout-minutes` | `timeout` | ✓ | [spec](F-13-timeout.md) |
| F-14 | Retry | execution | M1 | step-level retry (actions) | `retry`, `retry:when`, `retry:exit_codes` | ✗ deferred | [spec](F-14-retry.md) |
| F-15 | Matrix expansion | matrix | M1 | `strategy.matrix`, `include`, `exclude` | `parallel:matrix` | ✗ deferred | [spec](F-15-matrix.md) |
| F-16 | Fail-fast & max-parallel | matrix | M1 | `strategy.fail-fast`, `strategy.max-parallel` | implicit | ✗ deferred | [spec](F-16-fail-fast.md) |
| F-17 | Host runtime | runner | M0 | `runs-on: ubuntu-latest` | no `image` (runner default) | ✓ | [spec](F-17-host-runtime.md) |
| F-18 | Container runtime | runner | M0 | `container` | `image` | ✓ | [spec](F-18-container-runtime.md) |
| F-19 | Services | environment | M1 | `services` | `services` | ✗ deferred | [spec](F-19-services.md) |
| F-20 | Environment variables | environment | M0 | `env` (workflow/job/step) | `variables` (global/job) | ✓ | [spec](F-20-env-vars.md) |
| F-21 | Secrets | secrets | M0 | `secrets` context | `secrets`, `secrets:vault`, etc. | ✓ partial | [spec](F-21-secrets.md) |
| F-22 | Environments & deployments | deployment | M1 | `environment` (+ `url`, `deployment`) | `environment` (+ `action`, `on_stop`, `deployment_tier`) | ✗ deferred | [spec](F-22-environments.md) |
| F-23 | Scalar outputs | outputs | M0 | `$GITHUB_OUTPUT` | `artifacts:reports:dotenv` | ✓ | [spec](F-23-scalar-outputs.md) |
| F-24 | Artifact outputs | artifacts | M0 | `actions/upload-artifact` | `artifacts:paths` | ✓ | [spec](F-24-artifact-outputs.md) |
| F-25 | Artifact import | artifacts | M0 | `actions/download-artifact` | `needs` + `dependencies` | ✓ | [spec](F-25-artifact-import.md) |
| F-26 | Artifact expiry & access | artifacts | M1 | retention settings | `artifacts:expire_in`, `artifacts:access` | ✗ deferred | [spec](F-26-artifact-expiry.md) |
| F-27 | Cache | cache | M1 | `actions/cache` | `cache`, `cache:key`, `cache:policy` | ✗ deferred | [spec](F-27-cache.md) |
| F-28 | Concurrency & resource groups | concurrency | M1 | `concurrency` (+ `cancel-in-progress`, `queue`) | `resource_group` | ✗ deferred | [spec](F-28-concurrency.md) |
| F-29 | Interruptible & auto-cancel | concurrency | M1 | `concurrency.cancel-in-progress` | `interruptible`, `workflow:auto_cancel` | ✗ deferred | [spec](F-29-interruptible.md) |
| F-30 | Permissions | environment | M1 | `permissions` (workflow/job) | n/a (RBAC via project settings) | ✗ deferred | [spec](F-30-permissions.md) |
| F-31 | Reusable workflows & pipelines | reusable | M2 | `workflow_call` + `uses` + `with` + `secrets` | `include` + `trigger:include` | ✗ deferred | [spec](F-31-reusable-workflows.md) |
| F-32 | Reusable components | reusable | M2 | composite actions | `include:component`, `spec:component` | ✗ deferred | [spec](F-32-components.md) |
| F-33 | Dynamic child pipelines | reusable | M2 | `workflow_run` | `trigger:include` (child pipeline) | ✗ deferred | [spec](F-33-child-pipelines.md) |
| F-34 | Downstream project pipelines | reusable | M2 | `repository_dispatch` | `trigger:project` | ✗ deferred | [spec](F-34-downstream-projects.md) |
| F-35 | Expressions & contexts | expressions | M0 | `${{ }}` + contexts | `$CI_*` + CI/CD expressions | ✓ partial | [spec](F-35-expressions.md) |
| F-36 | Working directory & shell selection | execution | M0 | `working-directory`, `shell` | implicit (runner default) | ✓ partial | [spec](F-36-workdir-shell.md) |
| F-37 | Runner selection & labels | runner | M1 | `runs-on` (labels, groups) | `tags` | ✗ deferred | [spec](F-37-runner-selection.md) |
| F-38 | OIDC & identity federation | secrets | M1 | `permissions.id-token` | `id_tokens`, `identity` | ✗ deferred | [spec](F-38-oidc.md) |
| F-39 | Release | deployment | M2 | `softprops/action-gh-release` | `release` (+ `assets`) | ✗ deferred | [spec](F-39-release.md) |
| F-40 | Pages | deployment | M2 | `actions/deploy-pages` | `pages` (+ `path_prefix`) | ✗ deferred | [spec](F-40-pages.md) |
| F-41 | Rules | workflow-control | M0 | `if:` (single) | `rules` (array with if/changes/exists/when) | ✓ partial | [spec](F-41-rules.md) |
| F-42 | Workflow rules & auto-cancel | workflow-control | M1 | trigger filters (approximate) | `workflow:rules` | ✗ deferred | [spec](F-42-workflow-rules.md) |
| F-43 | Importer (GitHub/GitLab → Sverka) | import | M2 | reverse lowering | reverse lowering | ✗ deferred | [spec](F-43-importer.md) |
| F-44 | Config merging & extends | import | M1 | `workflow_call` (call, not merge) | `include` (merge) | ✗ deferred | [spec](F-44-includes.md) |
| F-45 | Defaults | workflow-control | M1 | `defaults.run` | `default` | ✗ deferred | [spec](F-45-defaults.md) |
| F-46 | Typed artifact reports | artifacts | M1 | upload-artifact reports | `artifacts:reports:*` (junit, sast, etc.) | ✗ deferred | [spec](F-46-artifact-reports.md) |
| F-47 | Typed inputs | workflow-control | M1 | `workflow_dispatch.inputs`, `workflow_call.inputs` | `spec:inputs` | ✗ deferred | [spec](F-47-typed-inputs.md) |
| F-48 | Delayed execution | scheduling | M2 | n/a (sleep step) | `when: delayed` + `start_in` | ✗ deferred | [spec](F-48-delayed-execution.md) |
| F-49 | Background execution | execution | M2 | n/a (shell `&`) | n/a (shell `&`) | ✗ deferred | [spec](F-49-background-execution.md) |

## By category

### Triggers (F-02 – F-06)

When a pipeline starts and which refs/paths trigger it.

### Scheduling (F-07 – F-08, F-11 – F-12, F-48)

DAG ordering, stages, conditions, failure tolerance, delayed start.

### Execution (F-09 – F-10, F-13 – F-14, F-36, F-49)

Shell commands, scripts, timeouts, retries, working directory, background steps.

### Runner (F-17 – F-18, F-37)

Where jobs execute — host, container, labels.

### Environment (F-19 – F-21, F-30)

Services, env vars, secrets, permissions.

### Artifacts (F-24 – F-26, F-46)

Producing, consuming, expiring, and typing artifacts.

### Cache (F-27)

Cross-run file caching.

### Outputs (F-23)

Scalar values passed between steps.

### Matrix (F-15 – F-16)

Fan-out execution across variable combinations.

### Concurrency (F-28 – F-29)

Mutual exclusion and auto-cancellation.

### Deployment (F-22, F-39 – F-40)

Environments, releases, pages.

### Reusable (F-31 – F-34)

Workflows, components, child pipelines, downstream projects.

### Expressions (F-35)

Expression syntax, contexts, functions.

### Import (F-43 – F-44)

Importers and config merging.

### Workflow control (F-01, F-41 – F-42, F-45, F-47)

Naming, rules, defaults, typed inputs.

## Review priority

**Review these first** — they are M0 features already in the 08/09 specs, and
the mini-specs propose refinements or reveal gaps:

- [F-01](F-01-naming.md) (naming), [F-02](F-02-trigger-push.md)–[F-04](F-04-trigger-manual.md) (triggers), [F-06](F-06-filters.md) (filters), [F-07](F-07-dag-dependencies.md)–[F-08](F-08-stages.md) (DAG/stages),
  [F-09](F-09-shell-operations.md) (shell), [F-13](F-13-timeout.md) (timeout), [F-17](F-17-host-runtime.md)–[F-18](F-18-container-runtime.md) (runtime), [F-20](F-20-env-vars.md) (env), [F-21](F-21-secrets.md) (secrets),
  [F-23](F-23-scalar-outputs.md)–[F-25](F-25-artifact-import.md) (outputs/artifacts), [F-35](F-35-expressions.md) (expressions), [F-36](F-36-workdir-shell.md) (workdir/shell), [F-41](F-41-rules.md) (rules)

**Review second** — M1 features that are the next growth wave:

- [F-05](F-05-trigger-schedule.md) (schedule), [F-10](F-10-before-after-script.md) (before/after script), [F-11](F-11-conditions.md) (conditions),
  [F-12](F-12-continue-on-error.md) (allow-failure), [F-14](F-14-retry.md) (retry), [F-15](F-15-matrix.md)–[F-16](F-16-fail-fast.md) (matrix), [F-19](F-19-services.md) (services),
  [F-22](F-22-environments.md) (environments), [F-26](F-26-artifact-expiry.md) (artifact expiry), [F-27](F-27-cache.md) (cache),
  [F-28](F-28-concurrency.md)–[F-29](F-29-interruptible.md) (concurrency), [F-30](F-30-permissions.md) (permissions), [F-37](F-37-runner-selection.md) (runner labels),
  [F-38](F-38-oidc.md) (OIDC), [F-42](F-42-workflow-rules.md) (workflow rules), [F-44](F-44-includes.md) (includes), [F-45](F-45-defaults.md) (defaults), [F-46](F-46-artifact-reports.md) (artifact reports),
  [F-47](F-47-typed-inputs.md) (typed inputs)

**Review last** — M2/M3 vision features:

- [F-31](F-31-reusable-workflows.md)–[F-34](F-34-downstream-projects.md) (reusable/child/downstream), [F-39](F-39-release.md)–[F-40](F-40-pages.md) (release/pages),
  [F-43](F-43-importer.md) (import), [F-48](F-48-delayed-execution.md) (delayed), [F-49](F-49-background-execution.md) (background)
