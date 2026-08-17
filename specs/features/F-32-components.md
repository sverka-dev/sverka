# Feature: Reusable components

**ID:** F-32
**Category:** reusable
**Milestone:** M2
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

Components are versioned, distributable reusable units with typed inputs and outputs. GitHub uses composite actions (action.yml with steps, inputs, outputs). GitLab uses CI/CD components (`include:component` with `spec:inputs` and `spec:component`). Sverka needs a portable component model.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | composite actions | CI/CD components | `component()` |
| Semantics | Reusable action with steps, inputs, outputs | Reusable config with typed inputs | Versioned reusable unit |
| Value type | action.yml file | component ref + inputs | component ref + inputs |
| Limitations | no versioning in repo | versioned via catalog | — |
| Provider gap | — | — | different distribution models |

## GitHub Actions

```yaml
# action.yml (composite action)
inputs:
  env:
    required: true
runs:
  using: composite
  steps:
    - run: deploy ${{ inputs.env }}

# usage
steps:
  - uses: org/deploy-action@v1
    with:
      env: staging
```

## GitLab CI

```yaml
include:
  - component: gitlab.com/group/deploy@1.0.0
    inputs:
      env: staging
```

Components are versioned and published to the CI/CD Catalog. `spec:inputs` defines typed inputs. `spec:component` exposes metadata.

## Sverka proposal

### Portable model

```ts
interface ComponentRef {
  readonly name: string;
  readonly version: string;
  readonly inputs: Record<string, unknown>;
}
```

A component is a versioned, distributable pipeline fragment with typed inputs. Components are resolved at synthesis time and inlined into the Definition Graph.

### Authoring API

```ts
// Use a component
defineWorkflow({
  name: "CI",
  workflow: pipeline(
    component("deploy", "1.0.0", { env: "staging" }),
  ),
}),
```

### Lowering

- **GitHub target:** `component` → `uses: org/component@version` with `with:` inputs. Requires the component to be published as a GitHub action.
- **GitLab target:** `component` → `include: component: gitlab.com/group/component@version` with `inputs:`.
- **Native engine:** resolve component from local registry, inline into graph.

### Capability manifest

```ts
"reusable.component": "native",
"reusable.component.versioning": "native",
```

### Portability & divergence

GitHub uses composite actions (GitHub Marketplace or repo). GitLab uses CI/CD Catalog components. Distribution mechanisms differ. Sverka's portable model references components by name + version. The actual resolution is provider-specific.

## Non-goals

- Component publishing and registry management.
- Component version resolution (semver ranges).
- Component catalog UI.

## Dependencies

- **Depends on:** F-31 (reusable workflows), F-47 (typed inputs).
- **Blocks:** none.

## Open questions

- Should Sverka have its own component registry?
- How are components resolved locally for the native engine?
- Should components support outputs (GitHub composite actions do)?

## References

- GitHub: https://docs.github.com/en/actions/creating-actions/creating-a-composite-action
- GitLab: https://docs.gitlab.com/ee/ci/components/
- Architecture spec: §25, §32 (deferred)
