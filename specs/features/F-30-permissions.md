# Feature: Permissions

**ID:** F-30
**Category:** environment
**Milestone:** M1
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

GitHub Actions uses `permissions` to control what the `GITHUB_TOKEN` can do — read/write access to contents, issues, PRs, packages, etc. GitLab has no YAML equivalent — permissions are managed via project/group RBAC settings. Sverka should support permissions as a GitHub provider extension.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `permissions` | (none in YAML) | `permissions` (GitHub extension) |
| Semantics | Controls GITHUB_TOKEN access scopes | RBAC via project settings | Declare required token scopes |
| Value type | map of scope→read/write/none, or `read-all`/`write-all`/`{}` | n/a | map of scope→permission |
| Limitations | — | — | GitLab: unsupported, emit info diagnostic |
| Provider gap | — | no YAML equivalent | — |

## GitHub Actions

```yaml
permissions:
  contents: read
  packages: write
  pull-requests: read
  id-token: write
```

Scopes: `actions`, `attestations`, `checks`, `contents`, `deployments`, `discussions`, `id-token`, `issues`, `packages`, `pages`, `pull-requests`, `security-events`, `statuses`, and more. Values: `read`, `write`, `none`. Shorthand: `read-all`, `write-all`, `{}` (disable all).

## GitLab CI

No YAML equivalent. Permissions are managed via:
- Project/group member roles
- Protected environments
- Protected variables
- CI/CD token scope settings

## Sverka proposal

### Portable model

Permissions are a GitHub provider extension — they control a GitHub-specific token. The portable model declares required scopes; the GitHub target lowers them to `permissions:`. The GitLab target emits an info diagnostic.

```ts
interface PermissionsSpec {
  readonly scopes: Record<string, "read" | "write" | "none">;
}
```

### Authoring API

```ts
// SDK — GitHub extension
defineWorkflow({
  name: "CI",
  workflow: pipeline(...),
  extensions: {
    github: { permissions: { contents: "read", packages: "write" } },
  },
}),

// Or via github.native()
github.native({
  permissions: { contents: "read", idToken: "write" },
}),
```

### Lowering

- **GitHub target:** `permissions` → `permissions:` map. Scope names converted from camelCase to kebab-case (`idToken` → `id-token`, `pullRequests` → `pull-requests`).
- **GitLab target:** `permissions` → not supported. Emit info diagnostic: "Permissions are GitHub-specific. GitLab uses project RBAC settings."
- **Native engine:** permissions are not relevant (no GITHUB_TOKEN). Ignored.

### Capability manifest

```ts
"environment.permissions": "native",       // GitHub
"environment.permissions": "unsupported",  // GitLab
```

### Portability & divergence

Permissions are entirely GitHub-specific. GitLab manages access through project roles and settings, not pipeline YAML. Sverka treats this as a provider extension — portable definitions don't include permissions, but GitHub-specific extensions can declare them.

## Non-goals

- GitLab RBAC configuration (infrastructure, not pipeline).
- OIDC token permissions (covered by F-38).
- Fine-grained token configuration.

## Dependencies

- **Depends on:** none.
- **Blocks:** F-38 (OIDC uses `id-token: write` permission).

## Open questions

- Should permissions be in the portable model with "unsupported on GitLab" or strictly a provider extension?
- Should `read-all`/`write-all` shorthand be supported?

## References

- GitHub: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#permissions
- Architecture spec: §25, §32 (deferred)
