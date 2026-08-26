# Feature: Release

**ID:** F-39
**Category:** deployment
**Milestone:** M2
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

Releases publish versioned artifacts (binaries, packages, changelogs) to the provider's release system. GitHub has no native keyword — uses actions like `softprops/action-gh-release`. GitLab has a native `release` keyword with tag, name, description, assets, and milestones. Sverka needs a portable release operation.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `softprops/action-gh-release` (action) | `release` (keyword) | `operation.release` |
| Semantics | Create GitHub release with tag, assets | Create GitLab release with tag, assets | Create release with tag and assets |
| Value type | action with inputs | map with tag_name, name, description, assets | `{ tag, name?, description?, assets? }` |
| Limitations | requires third-party action | native keyword | — |
| Provider gap | no native keyword | — | — |

## GitHub Actions

```yaml
steps:
  - uses: softprops/action-gh-release@v2
    with:
      tag_name: v1.0.0
      name: Release v1.0.0
      body: ${{ github.event.release.body }}
      files: |
        dist/bin.tar.gz
        dist/bin.zip
      draft: false
      prerelease: false
```

## GitLab CI

```yaml
release:
  release:
    tag_name: v1.0.0
    name: Release v1.0.0
    description: "Release notes"
    assets:
      links:
        - name: Binary
          url: https://example.com/bin.tar.gz
    milestones:
      - v1.0
  script: echo "Creating release"
```

## Sverka proposal

### Portable model

```ts
interface ReleaseSpec {
  readonly tag: string;
  readonly name?: string;
  readonly description?: string;
  readonly assets?: readonly string[];  // file paths (GitHub) or URLs (GitLab)
  readonly draft?: boolean;
  readonly prerelease?: boolean;
}
```

`Operation` with `kind: "release"`, `spec: ReleaseSpec`.

### Authoring API

```ts
task("release", {
  run: release({
    tag: "v1.0.0",
    name: "Release v1.0.0",
    description: "Release notes",
    assets: ["dist/bin.tar.gz"],
  }),
}),
```

### Lowering

- **GitHub target:** `release` → step with `uses: softprops/action-gh-release@v2`, `with:` mapping. `assets` → `files:` (newline-separated file paths/globs). Requires `permissions: { contents: "write" }` — emit a diagnostic if that permission is unavailable.
- **GitLab target:** `release` → `release:` keyword. `tag` → `tag_name`. `assets` → `assets: links:` (requires URLs, not file paths — emit warning if file paths are provided; local-path assets must be uploaded separately before linking).
- **Native engine:** not applicable (no release system locally). Print release info.

### Capability manifest

```ts
// gitlabCapabilities:
"deployment.release": "native",
// githubCapabilities:
"deployment.release": "emulated",  // via third-party action
```

### Portability & divergence

GitLab has a native `release` keyword. GitHub requires a third-party action. Asset handling differs: GitHub accepts file paths, GitLab requires URLs (uploaded separately). Sverka normalizes to file paths and warns on GitLab if URLs are needed.

## Non-goals

- Release asset upload to package registries.
- Release notes auto-generation from commits.
- Milestone association (GitLab-specific).

## Dependencies

- **Depends on:** F-22 (environments — releases often target environments).
- **Blocks:** none.

## Open questions

- Should Sverka bundle `softprops/action-gh-release` or let users choose?
- Should asset URLs vs file paths be a portable concern?
- Should `draft` and `prerelease` be in the portable model?

## References

- GitLab: https://docs.gitlab.com/ee/ci/yaml/#release
- GitHub: https://github.com/softprops/action-gh-release
- Architecture spec: §25, §32 (deferred)
