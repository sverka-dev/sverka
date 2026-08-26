# Feature: Typed artifact reports

**ID:** F-46
**Category:** artifacts
**Milestone:** M1
**Status:** Accepted
**Parent epic:** sv-4wh9

## Summary

Artifact reports are typed artifacts that the provider understands — test results, code coverage, security scans, etc. GitLab has native `artifacts:reports` with types (junit, coverage_report, dotenv, sast, dast, dependency_scanning, container_scanning, license_scanning, performance, metrics, terraform, quality). GitHub uses actions that upload specific report types (e.g., `dorny/test-reporter`, GitHub code scanning SARIF upload). Sverka needs a portable report type model.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | actions (various) | `artifacts:reports` | `report()` operation |
| Semantics | Upload typed report via action | Declare typed report artifact | Export typed report |
| Value type | action-specific | enum of report types | `{ type, path }` |
| Limitations | no native YAML keyword | limited report types | — |
| Provider gap | no native keyword | — | GitHub: emulated via actions |

## GitLab CI

```yaml
test:
  artifacts:
    reports:
      junit: test-results.xml
      coverage_report:
        coverage_format: cobertura
        path: coverage.xml
      dotenv: build.env
      sast: gl-sast-report.json
      dast: gl-dast-report.json
      dependency_scanning: gl-dependency-scanning-report.json
      container_scanning: gl-container-scanning-report.json
      license_scanning: gl-license-scanning-report.json
      performance: performance.json
      metrics: metrics.txt
      terraform: tf-plan.json
      quality: quality-report.json
```

## GitHub Actions

GitHub uses actions for each report type:

```yaml
steps:
  - uses: dorny/test-reporter@v1
    with:
      name: Tests
      path: test-results.xml
      reporter: java-junit
  - uses: github/codeql-action/upload-sarif@v3
    with:
      sarif_file: results.sarif
```

## Sverka proposal

### Portable model

```ts
type ReportType =
  | "junit"
  | "coverage"
  | "dotenv"
  | "sast"
  | "dast"
  | "dependencyScanning"
  | "containerScanning"
  | "licenseScanning"
  | "performance"
  | "metrics"
  | "terraform"
  | "quality"
  | "sarif";

interface ReportSpec {
  readonly type: ReportType;
  readonly path: string;
  readonly format?: string;  // required for "coverage": "cobertura" | "jacoco"
}
```

For `type: "coverage"`, `format` is required and must be `"cobertura"` or
`"jacoco"`. For other report types, `format` is optional. Unsupported or
missing coverage formats are rejected before lowering.

`Operation` with `kind: "report"`, `spec: ReportSpec`.

### Authoring API

```ts
task("test", {
  run: [
    sh`make test`,
    report({ type: "junit", path: "test-results.xml" }),
    report({ type: "coverage", path: "coverage.xml", format: "cobertura" }),
  ],
}),
```

### Lowering

- **GitHub target:** `report` → mapped to appropriate action. `junit` → `dorny/test-reporter@v1`. `sarif` → `github/codeql-action/upload-sarif@v3`. `sast` → GitLab SAST JSON is not SARIF; either convert to SARIF before upload or reject with a diagnostic (do not map `sast` directly to `upload-sarif`). Others → no standard action (emit warning, upload as generic artifact).
- **GitLab target:** `report` → `artifacts:reports:` with type mapping. `junit` → `junit:`. `coverage` → `coverage_report:`. `dotenv` → `dotenv:`. etc.
- **Native engine:** store report file. Sverka's findings package can consume SARIF and JUnit reports.

### Capability manifest

```ts
// gitlabCapabilities:
"artifact.report.junit": "native",
"artifact.report.coverage": "native",
"artifact.report.sarif": "native",
"artifact.report.sast": "native",
// githubCapabilities:
"artifact.report.junit": "emulated",      // via dorny/test-reporter
"artifact.report.coverage": "emulated",   // via action
"artifact.report.sarif": "native",        // via upload-sarif
"artifact.report.sast": "emulated",       // requires SARIF conversion
```

### Portability & divergence

GitLab has native typed reports. GitHub uses actions. Sverka maps each report type to the appropriate action on GitHub and the native keyword on GitLab. Some report types (terraform, quality, performance, metrics) have no GitHub action equivalent — they're uploaded as generic artifacts with a warning.

## Non-goals

- Report validation and schema checking.
- Report aggregation across multiple jobs.
- Custom report types.

## Dependencies

- **Depends on:** F-24 (artifact outputs).
- **Blocks:** none.

## Decisions (open questions resolved)

- **Mirror GitLab's report types plus `sarif`.** The `ReportType` enum
  covers GitLab's native set plus `sarif` for GitHub code scanning. This
  gives users a portable vocabulary without inventing new types.
- **Native engine: store report file only.** Parsing and display is the
  findings package's job. The engine just ensures the file exists.
- **`sarif` is a separate type.** It maps to `sast` on GitLab (via API)
  and `upload-sarif` on GitHub. Keeping it separate avoids ambiguity.

## References

- GitLab: https://docs.gitlab.com/ee/ci/yaml/#artifactsreports
- GitHub: https://github.com/dorny/test-reporter
- GitHub: https://github.com/github/codeql-action
- Architecture spec: §25, §32 (deferred)
