# Feature: Services

**ID:** F-19
**Category:** environment
**Milestone:** M1
**Status:** Accepted
**Parent epic:** sv-4wh9

## Summary

Service containers provide databases, message brokers, or other dependencies during job execution. GitHub uses `services` (map of containers). GitLab uses `services` (array with name, alias, entrypoint, command, variables). Sverka needs a portable service model that handles the structural difference (map vs array).

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `services` (map) | `services` (array) | `services` on Step |
| Semantics | Service containers run alongside job | Service containers run alongside job | Service containers for step |
| Value type | map of service definitions | array of service definitions | array of service definitions |
| Limitations | no `command`/`entrypoint` on job container | no `volumes`/`ports` | — |
| Provider gap | — | — | structural normalization (map vs array) |

## GitHub Actions

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: secret
        ports:
          - 5432:5432
      redis:
        image: redis:7
        ports:
          - 6379:6379
    steps:
      - run: make test
```

Services are a map keyed by service name. Each service has `image`, `credentials`, `env`, `ports`, `volumes`, `options`, `command`, `entrypoint`.

## GitLab CI

```yaml
test:
  services:
    - name: postgres:16
      alias: postgres
      variables:
        POSTGRES_PASSWORD: secret
    - name: redis:7
      alias: redis
  script:
    - make test
```

Services are an array. Each service has `name`, `alias`, `entrypoint`, `command`, `variables`, `docker`, `kubernetes`, `pull_policy`.

## Sverka proposal

### Portable model

```ts
interface ServiceContainer {
  readonly name: string;       // service identifier
  readonly image: string;
  readonly alias?: string;
  readonly env?: Record<string, string>;
  readonly ports?: readonly number[];
  readonly entrypoint?: readonly string[];
  readonly command?: readonly string[];
}
```

Step gets optional `services?: readonly ServiceContainer[]`.

### Authoring API

```ts
// SDK
task("test", {
  run: ...,
  services: [
    { name: "postgres", image: "postgres:16", env: { POSTGRES_PASSWORD: "secret" }, ports: [5432] },
    { name: "redis", image: "redis:7", ports: [6379] },
  ],
}),
```

### Lowering

- **GitHub target:** `services` → `services:` map. `name` → map key. `image` → `image`. `alias` → ignored (GitHub uses service name as hostname). `env` → `env`. `ports` → `ports`.
- **GitLab target:** `services` → `services:` array. `image` → `name` (GitLab's `name` is the image reference). `name` → `alias` (Sverka's service identifier becomes the hostname alias). If `alias` is absent, fall back to the `name` value. `env` → `variables`. `ports` → not supported (emit warning). `entrypoint` → `entrypoint`. `command` → `command`.
- **Native engine:** start service containers via Docker/Podman, execute step, stop containers. A bounded readiness check (TCP port probe with a 30-second timeout) is performed before executing the step. If the probe fails, the step fails with a diagnostic. Full health checks and custom wait conditions are non-goals (see below).

### Capability manifest

```ts
// githubCapabilities:
"environment.services": "native",
"environment.services.ports": "native",
// gitlabCapabilities:
"environment.services": "native",
"environment.services.ports": "unsupported",
```

### Portability & divergence

GitHub uses a map (keyed by name); GitLab uses an array (with `alias` for hostname). Sverka normalizes to an array with `name` and `alias`. On GitHub, `alias` is dropped (name is the hostname). On GitLab, `ports` is dropped (services are on the same network). These are minor divergences documented via diagnostics.

## Non-goals

- Service health checks and wait conditions.
- Service dependency ordering.
- Kubernetes-specific service options.

## Dependencies

- **Depends on:** F-18 (container runtime — services are containers).
- **Blocks:** none.

## Decisions (open questions resolved)

- **No service health checks in this feature.** Health checks and wait
  conditions are a runtime concern (F-18 / native engine). This feature
  only adds the portable service model and target lowering.
- **`ports` uses container port only (number).** GitHub's `host:container`
  mapping is provider-specific. The portable model uses container ports.
  GitHub lowering emits `port:port` (same on both sides). GitLab does not
  support ports and emits a diagnostic.

## References

- GitHub: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idservices
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#services
- Architecture spec: §25, §32 (deferred)
