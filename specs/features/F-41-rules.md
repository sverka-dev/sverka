# Feature: Rules

**ID:** F-41
**Category:** workflow-control
**Milestone:** M0 (already in v0, partial)
**Status:** Accepted
**Parent epic:** sv-4wh9

## Summary

Rules are conditional logic that determines whether a job runs. GitLab uses `rules` with `if`, `changes`, `exists`, `when`, `allow_failure`, `needs`, `variables`, and `interruptible`. GitHub uses `if:` expressions at job and step level. Sverka's `condition` (F-11) covers the basic case; this spec covers the full `rules` model including changes-based and exists-based conditions.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `if:` | `rules` | `condition` + `rules` on Step |
| Semantics | Expression evaluated to boolean | Array of rule conditions, first match wins | Array of conditions, first match wins |
| Value type | expression string | array of rule objects | array of condition objects |
| Limitations | single condition per step | `changes`, `exists`, `if` per rule | — |
| Provider gap | no `changes`/`exists` | — | GitHub: `changes` emulated via paths filter |

## GitLab CI

```yaml
deploy:
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
      when: on_success
      allow_failure: false
      variables:
        DEPLOY_ENV: production
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      when: manual
    - changes:
        - src/**/*
      when: on_success
    - exists:
        - package.json
      when: on_success
    - when: never
```

Rules are evaluated in order. First match wins. Each rule can have `if`, `changes`, `exists`, `when`, `allow_failure`, `needs`, `variables`, `interruptible`.

## GitHub Actions

```yaml
jobs:
  deploy:
    if: github.ref == 'refs/heads/main'
    steps:
      - run: deploy
```

GitHub has a single `if:` per job/step. No `changes` or `exists` conditions (path filters are on triggers, not conditions).

## Sverka proposal

### Portable model

```ts
interface Rule {
  readonly if?: ExpressionString;
  readonly changes?: readonly string[];
  readonly exists?: readonly string[];
  readonly when?: "on_success" | "on_failure" | "always" | "never" | "manual";
  readonly variables?: Record<string, string>;
}

// Step gets optional `rules?: readonly Rule[]`
```

Rules are evaluated in order. First match wins. If no rule matches, the step doesn't run.

### Authoring API

```ts
task("deploy", {
  run: ...,
  rules: [
    { if: expr`${git.branch} == "main"`, when: "on_success", variables: { DEPLOY_ENV: "production" } },
    { if: expr`${event.source} == "merge_request"`, when: "manual" },
    { when: "never" },
  ],
}),
```

### Lowering

- **GitHub target:** `rules` → GitHub has no rules array. Approximate: evaluate rules at synthesis time if possible (static conditions). For dynamic conditions, use `if:` with the first rule's expression. `changes` → not supported (emit warning). `exists` → not supported (emit warning). `variables` per-rule → not supported (emit warning).
- **GitLab target:** `rules` → `rules:` array. Direct mapping.
- **Native engine:** evaluate rules in order against runtime context. First match determines execution.

### Capability manifest

```ts
"workflow.rules": "native",          // GitLab
"workflow.rules": "partial",         // GitHub (first rule only, no changes/exists)
"workflow.rules.changes": "native",  // GitLab
"workflow.rules.changes": "unsupported", // GitHub
"workflow.rules.exists": "native",   // GitLab
"workflow.rules.exists": "unsupported", // GitHub
```

### Portability & divergence

GitLab's `rules` is much richer than GitHub's `if:`. Sverka supports the full rules model but only the `if` + `when` subset lowers cleanly to GitHub. `changes`, `exists`, and per-rule `variables` are GitLab-only. This is a significant divergence — Sverka documents it and lowers what it can to GitHub.

## Non-goals

- `rules:needs` (covered by F-07).
- `rules:interruptible` (covered by F-29).
- `only`/`except` (deprecated GitLab keywords).

## Dependencies

- **Depends on:** F-11 (conditions — `when` maps to condition status), F-35 (expressions).
- **Blocks:** none.

## Decisions (open questions resolved)

- **`condition` and `rules` coexist.** `condition` is a single expression
  (F-11); `rules` is an ordered array with richer semantics. If both are
  set, `rules` takes precedence (the condition is ignored). This avoids
  breaking existing `condition` users while enabling the richer `rules` model.
- **No GitHub `changes` emulation via path filters.** Path filters are on
  triggers, not conditions. Emulating would conflate trigger semantics with
  condition semantics. Emit a warning instead.
- **Per-rule `variables` stays in the portable model.** GitLab supports it
  natively. GitHub doesn't — emit a warning. No provider extension needed.

## References

- GitLab: https://docs.gitlab.com/ee/ci/yaml/#rules
- GitHub: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idif
- Architecture spec: §25, §31.3
