# Feature: Step & job conditions

**ID:** F-11
**Category:** scheduling
**Milestone:** M1
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

Conditions control whether a step or job runs based on prior results. GitHub uses expression-based `if:` with functions like `success()`, `failure()`, `always()`. GitLab uses `rules:when` with `on_success`, `on_failure`, `always`, `never`. Sverka needs a portable condition model that lowers to both.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `steps[*].if`, `jobs.<id>.if` | `rules:when`, `rules:if` | `condition` on Step |
| Semantics | Expression evaluated to boolean | Pipeline status + variable expression | Condition expression |
| Value type | expression string | `when:` enum + `if:` expression | expression or status enum |
| Limitations | expression syntax is GitHub-specific | `when` is limited enum | — |
| Provider gap | — | — | expression translation needed |

## GitHub Actions

```yaml
steps:
  - name: Deploy
    if: success() && github.ref == 'refs/heads/main'
    run: make deploy
  - name: Notify failure
    if: failure()
    run: notify-slack
```

Status functions: `success()` (default), `failure()`, `always()`, `cancelled()`. Expressions support `&&`, `||`, `!`, comparisons, and context access (`github.*`, `steps.*`, `env.*`).

## GitLab CI

```yaml
deploy:
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
      when: on_success
  script: make deploy

notify_failure:
  rules:
    - when: on_failure
  script: notify-slack
```

`when` values: `on_success` (default), `on_failure`, `always`, `never`, `manual`, `delayed`. `rules:if` uses CI/CD variable expressions.

## Sverka proposal

### Portable model

Add optional `condition?: Condition` to Step:

```ts
type Condition =
  | { status: "success" | "failure" | "always" | "never" }
  | { expression: ExpressionString };
```

The `status` form maps directly to both providers' status enums. The `expression` form uses Sverka's portable expression syntax (F-35) and is translated during lowering.

### Authoring API

```ts
// SDK — status-based
task("deploy", { run: ..., condition: { status: "success" } }),

// SDK — expression-based
task("notify", { run: ..., condition: { expression: expr`failure() && ${git.branch} == "main"` } }),
```

### Lowering

- **GitHub target:** `condition.status: "success"` → `if: success()`. `"failure"` → `if: failure()`. `"always"` → `if: always()`. `"never"` → `if: false`. `condition.expression` → `if: <translated expression>`.
- **GitLab target:** `condition.status` → `rules:when: <mapped>`. `condition.expression` → `rules:if: <translated expression>`.
- **Native engine:** evaluate condition against prior step results.

### Capability manifest

```ts
"scheduling.condition": "native",
"scheduling.condition.expression": "lowered",  // expression translation needed
```

### Portability & divergence

Status-based conditions map cleanly. Expression-based conditions require translation between GitHub's `${{ }}` syntax and GitLab's `$CI_*` variable expressions. Sverka uses its own expression layer (F-35) and translates during lowering. Some expressions may not have equivalents — emit diagnostics.

## Non-goals

- `manual` and `delayed` `when` values (covered by F-04 and F-48).
- Per-step conditions within a job (Sverka Step = job, conditions are Step-level).

## Dependencies

- **Depends on:** F-35 (expressions) for expression-based conditions.
- **Blocks:** none.

## Open questions

- Should `condition` support combining status + expression (e.g., `failure() && expr`)?
- Should the status enum be a typed union or string?

## References

- GitHub: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idif
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#ruleswhen
- Architecture spec: §25, §32 (deferred)
