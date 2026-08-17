# Feature: Artifact expiry & access

**ID:** F-26
**Category:** artifacts
**Milestone:** M1
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

Artifacts don't live forever — they expire and have access controls. GitHub uses `retention-days` on upload-artifact. GitLab uses `artifacts:expire_in`, `artifacts:access`, and `artifacts:public`. Sverka needs a portable retention and access model.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `retention-days` (upload-artifact) | `artifacts:expire_in`, `artifacts:access` | `retention`, `access` on artifact |
| Semantics | Days before artifact is deleted | Duration before deletion + who can access | Retention duration + access level |
| Value type | number (days) | duration string + enum | duration string + enum |
| Limitations | repo/org retention settings override | `access`: all/developer/maintainer/none | — |
| Provider gap | no access control in YAML | no per-artifact retention-days | — |

## GitHub Actions

```yaml
- uses: actions/upload-artifact@v4
  with:
    name: build
    path: dist/
    retention-days: 7
```

Retention is set per artifact in days. Repo/org settings can enforce minimum/maximum retention.

## GitLab CI

```yaml
build:
  artifacts:
    paths: [dist/]
    expire_in: 7 days
    access: developer
```

`expire_in`: duration string or `never`. `access`: `all`, `developer`, `maintainer`, `none`. `public` (deprecated, superseded by `access`).

## Sverka proposal

### Portable model

Add optional fields to artifact export:

```ts
interface ArtifactExport {
  readonly name: string;
  readonly path: string;
  readonly retention?: string;        // duration string: "7d", "1h", "never"
  readonly access?: "all" | "developer" | "maintainer" | "none";
}
```

### Authoring API

```ts
task("build", {
  run: ...,
  artifacts: [artifact("build", "dist/", { retention: "7d", access: "developer" })],
}),
```

### Lowering

- **GitHub target:** `retention` → `retention-days` (parse duration, convert to days). `access` → not supported in YAML (emit warning — access is controlled by repo settings).
- **GitLab target:** `retention` → `artifacts: expire_in`. `access` → `artifacts: access`.
- **Native engine:** `retention` is metadata (artifacts cleaned up by external process). `access` is not enforced locally.

### Capability manifest

```ts
"artifact.retention": "native",
"artifact.access": "native",       // GitLab
"artifact.access": "unsupported",  // GitHub
```

### Portability & divergence

GitHub has retention but no YAML-level access control. GitLab has both. Sverka lowers `retention` to both providers and `access` to GitLab only (warning on GitHub).

## Non-goals

- Repo/org-level retention policy configuration.
- Artifact locking (preventing deletion).
- Public artifact sharing.

## Dependencies

- **Depends on:** F-24 (artifact outputs).
- **Blocks:** none.

## Open questions

- Should `retention` use duration strings or days (number)?
- Should `access: "none"` be valid (why export an artifact no one can access)?

## References

- GitHub: https://github.com/actions/upload-artifact#retention-period
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#artifactsexpire_in
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#artifactsaccess
- Architecture spec: §25, §32 (deferred)
