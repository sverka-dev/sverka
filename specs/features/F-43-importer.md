# Feature: Importer (GitHub → Sverka, GitLab → Sverka)

**ID:** F-43
**Category:** import
**Milestone:** M2
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

Importers read existing GitHub Actions workflows or GitLab CI configs and convert them to Sverka's Definition Graph. This enables migration from existing CI configs. The architecture spec mentions importers as a deferred capability. This spec proposes the importer interface and mapping strategy.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `.github/workflows/*.yml` | `.gitlab-ci.yml` | `importGitHub()` / `importGitLab()` |
| Semantics | Parse YAML → Definition Graph | Parse YAML → Definition Graph | Reverse lowering |
| Value type | YAML file | YAML file | `DefinitionGraph` |
| Limitations | not all GitHub features map | not all GitLab features map | lossy import for unsupported features |
| Provider gap | — | — | — |

## GitHub Actions

Importing a GitHub workflow requires:
1. Parse the YAML file.
2. Extract triggers → Entry nodes.
3. Extract jobs → Step nodes.
4. Extract `needs` → dependency edges.
5. Extract `steps[*].run` → shell operations.
6. Extract `steps[*].uses` → provider-native operations (or map known actions).
7. Extract `env`, `secrets`, `matrix`, `cache`, `services` → corresponding Sverka constructs.
8. Unmappable constructs → provider extension nodes with diagnostics.

## GitLab CI

Importing a GitLab CI config requires:
1. Parse the YAML file.
2. Resolve `include` directives via an injected, allowlisted resolver. Local includes are anchored to the repository root. Remote and cross-project includes are disabled by default (network access off) and produce diagnostics. Only source-controlled local YAML targets are resolved.
3. Extract `workflow:rules` → pipeline rules.
4. Extract jobs → Step nodes.
5. Extract `needs`, `dependencies` → dependency edges.
6. Extract `script`, `before_script`, `after_script` → shell operations.
7. Extract `image`, `services`, `cache`, `artifacts`, `variables` → corresponding Sverka constructs.
8. Unmappable constructs → provider extension nodes with diagnostics.

## Sverka proposal

### Portable model

```ts
interface Importer {
  import(source: string): DefinitionGraph;
  importWithDiagnostics(source: string): { graph: DefinitionGraph; diagnostics: Diagnostic[] };
}

const githubImporter: Importer = createGithubImporter();
const gitlabImporter: Importer = createGitlabImporter();
```

### Authoring API

```ts
// Import existing workflow
const graph = importGitHub(workflowYaml);
// or
const graph = importGitLab(gitlabCiYaml);

// With diagnostics
const { graph, diagnostics } = githubImporter.importWithDiagnostics(yaml);
```

### Lowering

Importers are the reverse of lowering — they parse provider YAML and construct a Definition Graph. The import is inherently lossy for provider-specific features. Unmappable constructs are preserved as provider extension nodes with diagnostic warnings.

- **GitHub target:** `importGitHub()` parses `.github/workflows/*.yml`.
- **GitLab target:** `importGitLab()` parses `.gitlab-ci.yml` + includes.
- **Native engine:** not applicable (importers produce IR, not runtime behavior).

### Capability manifest

```ts
"import.github": "native",
"import.gitlab": "native",
```

### Portability & divergence

Import is inherently provider-specific. Each importer understands one provider's syntax and maps it to Sverka's portable model. Unmappable features are preserved as provider extensions. The import is not guaranteed to be round-trip safe (import → lower may produce different YAML than the original).

## Non-goals

- Round-trip fidelity (import → lower = original).
- Importing deprecated keywords (`only`/`except`).
- Importing composite actions or CI/CD components.
- Automatic migration suggestions.

## Dependencies

- **Depends on:** F-35 (expressions — import expression syntax), all feature specs (importers must understand all constructs).
- **Blocks:** none.

## Open questions

- Should importers be standalone packages or part of the compiler packages?
- How should provider-specific actions (e.g., `actions/checkout`) be mapped?
- Should importers support partial import (specific jobs)?
- Should the import produce Sverka authoring code (SDK/Construct) or just the IR?

## References

- GitHub: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions
- GitLab: https://docs.gitlab.com/ee/ci/yaml/
- Architecture spec: §25, §32 (deferred — GitHub Importer, GitLab Importer)
