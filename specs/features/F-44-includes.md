# Feature: Config merging & extends

**ID:** F-44
**Category:** import
**Milestone:** M1
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

Config merging combines multiple config files into one. GitLab uses `include` (local, project, remote, template, component) with `inputs` and deep merge semantics. GitHub uses reusable workflows (`workflow_call`) but doesn't merge configs. Sverka needs a portable include/merge model.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `workflow_call` (call, not merge) | `include` (merge) | `include()` |
| Semantics | Call reusable workflow as job | Merge included config into current | Include and merge config fragments |
| Value type | workflow file ref | array of include refs | array of include refs |
| Limitations | no config merging | deep merge with override rules | — |
| Provider gap | no config merging | — | GitHub: unsupported, use reusable workflows |

## GitLab CI

```yaml
include:
  - local: /templates/build.yml
    inputs:
      image: node:24
  - project: group/shared
    file: deploy.yml
    ref: main
  - remote: https://example.com/ci.yml
  - template: Security/SAST.gitlab-ci.yml
```

Include types: `local` (file in same repo), `project` (file in another project), `remote` (URL), `template` (GitLab template), `component` (CI/CD component). Includes are merged deeply — later includes override earlier ones. `inputs` pass parameters to included configs with `spec:inputs`.

## GitHub Actions

No config merging. Reusable workflows are called, not merged:

```yaml
jobs:
  build:
    uses: ./.github/workflows/build.yml
    with:
      image: node:24
```

## Sverka proposal

### Portable model

```ts
interface IncludeRef {
  readonly path: string;          // local file path
  readonly inputs?: Record<string, unknown>;
}
```

Pipeline definition can include other pipeline fragments:

```ts
defineWorkflow({
  name: "CI",
  includes: [
    { path: "templates/build.yml", inputs: { image: "node:24" } },
  ],
  workflow: pipeline(...),
}),
```

### Lowering

- **GitHub target:** `includes` → not supported (GitHub doesn't merge configs). Emit warning. Alternative: inline included fragments at synthesis time (Sverka resolves includes before lowering).
- **GitLab target:** `includes` → `include:` array. `path` → `local:`. `inputs` → `inputs:`.
- **Native engine:** resolve includes at synthesis time — read included files, merge definitions, produce unified Definition Graph.

### Capability manifest

```ts
"import.include": "native",       // GitLab
"import.include": "emulated",     // GitHub (resolved at synthesis)
```

### Portability & divergence

GitLab merges configs natively. GitHub doesn't merge at all. Sverka's approach: resolve includes at synthesis time (before lowering), producing a unified Definition Graph. This works for both providers — the lowering sees a single graph and doesn't need to emit `include:` directives. On GitLab, Sverka can optionally emit `include:` for smaller generated YAML.

## Non-goals

- Remote includes (URL-based).
- Cross-project includes (GitLab `include:project`).
- Template includes (GitLab `include:template`).
- Deep merge conflict resolution strategies.

## Dependencies

- **Depends on:** F-31 (reusable workflows — related concept), F-47 (typed inputs).
- **Blocks:** none.

## Open questions

- Should Sverka resolve includes at synthesis time or preserve them in the IR?
- Should remote and cross-project includes be supported?
- How are merge conflicts resolved (override vs error)?

## References

- GitLab: https://docs.gitlab.com/ee/ci/yaml/#include
- Architecture spec: §25, §32 (deferred)
