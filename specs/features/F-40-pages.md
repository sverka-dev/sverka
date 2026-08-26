# Feature: Pages

**ID:** F-40
**Category:** deployment
**Milestone:** M2
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

Pages deploy static content to the provider's hosting service. GitHub uses `actions/upload-pages-artifact` + `actions/deploy-pages` actions with specific permissions. GitLab uses the `pages` keyword with `publish`, `path_prefix`, and `expire_in`. Sverka needs a portable pages deployment operation.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `actions/deploy-pages` | `pages` | `operation.deployPages` |
| Semantics | Deploy static site to GitHub Pages | Deploy static site to GitLab Pages | Deploy static site |
| Value type | action with artifact | map with publish, path_prefix, expire_in | `{ path }` |
| Limitations | requires `pages: write`, `id-token: write` | special job named "pages" | — |
| Provider gap | — | — | — |

## GitHub Actions

```yaml
permissions:
  pages: write
  id-token: write

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist/
      - uses: actions/deploy-pages@v4
        id: deployment
```

## GitLab CI

```yaml
pages:
  pages:
    publish: dist/
    path_prefix: project-name
    expire_in: 30 days
  script: echo "Deploying pages"
  artifacts:
    paths:
      - dist/
```

GitLab requires the job to use the `pages` keyword. Modern GitLab no longer requires the job to be named `pages` — a user-defined job name with `pages: { publish: <path> }` is supported. `publish` sets the content directory. `path_prefix` for parallel deployments. `expire_in` controls deployment lifetime.

## Sverka proposal

### Portable model

```ts
interface PagesSpec {
  readonly path: string;          // directory containing static content
  readonly prefix?: string;       // path prefix (GitLab)
}
```

`Operation` with `kind: "deployPages"`, `spec: PagesSpec`.

### Authoring API

```ts
task("deploy-pages", {
  run: deployPages({ path: "dist/" }),
}),
```

### Lowering

- **GitHub target:** `deployPages` → step with `uses: actions/upload-pages-artifact@v3` (upload) + `uses: actions/deploy-pages@v4` (deploy). Auto-set `permissions: { pages: "write", "id-token": "write" }` and `environment: { name: "github-pages" }`.
- **GitLab target:** `deployPages` → job with `pages: publish: <path>`. The job name is user-defined (collision-safe); the legacy `pages` job name is not required on modern GitLab. `prefix` → `path_prefix`. Artifacts auto-declared for the path.
- **Native engine:** not applicable (no Pages hosting locally). Print deployment info.

### Capability manifest

```ts
// githubCapabilities:
"deployment.pages": "lowered",     // via actions
// gitlabCapabilities:
"deployment.pages": "lowered",     // via pages keyword
// nativeCapabilities:
"deployment.pages": "unsupported", // no Pages hosting locally
```

### Portability & divergence

Both providers have Pages hosting but with different APIs. GitHub uses actions + specific permissions + environment. GitLab uses a special job named `pages` with the `pages` keyword. Sverka normalizes to a `deployPages` operation and handles the provider-specific setup during lowering.

## Non-goals

- Custom domain configuration.
- Pages build pipeline (only deployment, not site generation).
- `expire_in` for GitLab Pages (provider-specific).

## Dependencies

- **Depends on:** F-22 (environments), F-30 (permissions — GitHub needs pages: write).
- **Blocks:** none.

## Open questions

- Should Sverka auto-set GitHub permissions for pages, or require explicit declaration?
- Should the GitLab job name `pages` be enforced by the lowering?
- Should `path_prefix` be in the portable model or GitLab-only?

## References

- GitHub: https://github.com/actions/deploy-pages
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#pages
- Architecture spec: §25, §32 (deferred)
