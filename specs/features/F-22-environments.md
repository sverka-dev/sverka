# Feature: Environments & deployments

**ID:** F-22
**Category:** deployment
**Milestone:** M1
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

Environments group deployment targets (staging, production) with protection rules, required reviewers, and deployment tracking. GitHub uses `environment` with name, url, and deployment flag. GitLab uses `environment` with name, url, action, on_stop, auto_stop_in, deployment_tier, and kubernetes config. Sverka needs a portable environment model with lifecycle actions.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `environment` | `environment` | `environment` on Step |
| Semantics | Deploy to named environment with protection rules | Deploy to environment with lifecycle actions | Deploy to named environment |
| Value type | string or map | string or map | `{ name, url?, action? }` |
| Limitations | no lifecycle actions | rich lifecycle (start/stop/verify) | portable subset + extensions |
| Provider gap | no on_stop, no deployment_tier | no protection rules in YAML | — |

## GitHub Actions

```yaml
deploy:
  environment:
    name: production
    url: https://app.example.com
  steps:
    - run: deploy
```

Environments are configured in repo settings with protection rules (required reviewers, wait timer, branch restriction). `environment.deployment: false` uses the environment without creating a deployment record.

## GitLab CI

```yaml
deploy:
  environment:
    name: production
    url: https://app.example.com
    action: start
    on_stop: stop_deploy
    deployment_tier: production
  script: deploy

stop_deploy:
  environment:
    name: production
    action: stop
  script: stop-deploy
```

`action`: `start`, `prepare`, `stop`, `verify`, `access`. `on_stop` references a job that stops the environment. `auto_stop_in` sets environment lifetime. `deployment_tier`: production, staging, testing, development, other.

## Sverka proposal

### Portable model

```ts
interface EnvironmentSpec {
  readonly name: string;
  readonly url?: string;
  readonly action?: "start" | "stop" | "verify";
  readonly tier?: "production" | "staging" | "testing" | "development";
}
```

Step gets optional `environment?: EnvironmentSpec`.

### Authoring API

```ts
// SDK
task("deploy", {
  run: ...,
  environment: { name: "production", url: "https://app.example.com", tier: "production" },
}),

// Stop action
task("stop-deploy", {
  run: ...,
  environment: { name: "production", action: "stop" },
}),
```

### Lowering

- **GitHub target:** `environment` → `environment:` map. `name` → `name`. `url` → `url`. `action` → not supported (emit warning). `tier` → not supported (emit warning).
- **GitLab target:** `environment` → `environment:` map. `name` → `name`. `url` → `url`. `action` → `action`. `tier` → `deployment_tier`. For `action: "stop"`, link to the stop step via `on_stop`.
- **Native engine:** `environment` is metadata. `name` and `tier` are displayed in output. `url` is printed. `action: "stop"` triggers the stop operations.

### Capability manifest

```ts
"deployment.environment": "native",
"deployment.environment.action": "native",       // GitLab
"deployment.environment.action": "unsupported",  // GitHub
"deployment.environment.tier": "native",         // GitLab
"deployment.environment.tier": "unsupported",    // GitHub
```

### Portability & divergence

GitLab has richer environment lifecycle (actions, on_stop, auto_stop, tiers). GitHub has protection rules (configured outside YAML). Sverka's portable model covers name, url, action, and tier. Protection rules are GitHub infrastructure, not YAML. `on_stop` linking is a GitLab-specific lowering concern.

## Non-goals

- Environment protection rules (GitHub infrastructure, not YAML).
- Kubernetes configuration (`environment:kubernetes` — GitLab extension).
- `auto_stop_in` (GitLab-specific timer).

## Dependencies

- **Depends on:** none.
- **Blocks:** F-39 (release), F-40 (pages) — both are deployment types.

## Open questions

- Should `on_stop` be explicit in Sverka or auto-derived from `action: "stop"` steps?
- Should `prepare` and `access` actions be in the portable model?
- Should protection rules be declarable in Sverka (even if lowered to provider settings)?

## References

- GitHub: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idenvironment
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#environment
- Architecture spec: §25, §32 (deferred)
