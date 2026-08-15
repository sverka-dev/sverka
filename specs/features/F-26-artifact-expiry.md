# Feature: Artifact expiry & access

**ID:** F-26
**Category:** artifacts
**Milestone:** M1
**Status:** Accepted
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

- **GitHub target:** `retention` → `retention-days` (parse duration, convert to days). Conversion rules: `"7d"` → `7`, `"1h"` → `1` (minimum 1 day — emit warning that sub-day retention is rounded up). `"never"` → omit `retention-days` (uses repository default; `retention-days: 0` is not used because it means "use repository default", not "never expire"). `access` → not supported in YAML (emit warning — access is controlled by repo settings).
- **GitLab target:** `retention` → `artifacts: expire_in`. `access` → `artifacts: access`.
- **Native engine:** `retention` is metadata (artifacts cleaned up by external process). `access` is not enforced locally.

### Capability manifest

```ts
// gitlabCapabilities:
"artifact.retention": "native",
"artifact.access": "native",
// githubCapabilities:
"artifact.retention": "native",
"artifact.access": "unsupported",
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

## Decisions (open questions resolved)

- **`retention` uses duration strings.** Format: `"7d"`, `"1h"`, `"30m"`,
  `"never"`. This is provider-neutral. GitHub lowering parses the duration
  and converts to days. GitLab lowering converts to GitLab's duration
  format (e.g., `"7 days"`).
- **`access: "none"` is valid.** It can be used to export an artifact
  that is only accessible by the pipeline system itself (e.g., for
  internal tracking or baseline comparison). The provider may restrict
  further, but the model allows it.

## References

- GitHub: https://github.com/actions/upload-artifact#retention-period
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#artifactsexpire_in
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#artifactsaccess
- Architecture spec: §25, §32 (deferred)
