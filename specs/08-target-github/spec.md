# Spec 08 — Target github (native lowering)

**Status:** Active
**Source:** specs/architecture-spec.md §18.1, §19, §31.3, §32
**Package:** `@sverka/github` (new)

## Overview

The GitHub target performs native lowering from a Definition Graph to
GitHub Actions YAML. It implements the Target contract (§19):
analyze → lower → emit. This is NOT a thin wrapper — it maps each
Step to a GitHub job with needs, runs-on, checkout, operation→step
mapping, artifact upload/download, scalar output via $GITHUB_OUTPUT,
and trigger mapping.

## Goals

- `GithubTarget` implementing the Target interface (§19)
- `analyze(graph)` → diagnostics via capability analysis
- `lower(graph)` → GithubTargetGraph (intermediate representation)
- `emit(targetGraph)` → GeneratedArtifact[] (YAML files)
- One GitHub job per Step
- Step dependencies → job `needs`
- Runtime mode → `runs-on` (host → ubuntu-latest, container → container:)
- Shell operations → job steps with `run:`
- Artifact outputs → `actions/upload-artifact`
- Artifact imports → `actions/download-artifact`
- Scalar outputs → `$GITHUB_OUTPUT` env file
- Trigger mapping: push→push, changeRequest→pull_request, manual→workflow_dispatch
- Capability manifest declaring GitHub support levels
- Deterministic output
- Source mappings for diagnostics

## Non-goals

- Matrix expansion (§32 — deferred)
- Cache (§32 — deferred)
- Services (§32 — deferred)
- Schedule triggers (§32 — deferred)
- Retry policy (§32 — deferred)
- Concurrency groups (§32 — deferred)
- GitHub importer (§32 — deferred)
- Provider-native actions in portable core (§32 — deferred)

## Interfaces

```ts
// Target contract (§19)
class GithubTarget implements Target {
  readonly name = "github";
  readonly capabilities: CapabilityManifest;
  analyze(graph: DefinitionGraph): readonly TargetDiagnostic[];
  lower(graph: DefinitionGraph): GithubTargetGraph;
  emit(targetGraph: GithubTargetGraph): readonly GeneratedArtifact[];
  compile(graph: DefinitionGraph): CompilationResult;
}

// Convenience function
function compileGithub(graph: DefinitionGraph): CompilationResult;
```

### GithubTargetGraph

```ts
interface GithubTargetGraph {
  readonly name: string;
  readonly on: GithubTriggers;
  readonly jobs: readonly GithubJob[];
  readonly env: Record<string, string>;
}

interface GithubTriggers {
  readonly push?: { readonly branches?: readonly string[] };
  readonly pull_request?: { readonly branches?: readonly string[] };
  readonly workflow_dispatch?: null;
}

interface GithubJob {
  readonly id: string;
  readonly name: string;
  readonly runsOn: string;
  readonly needs: readonly string[];
  readonly steps: readonly GithubStep[];
  readonly timeoutMinutes?: number;
  readonly env?: Record<string, string>;
  readonly container?: string;
}

interface GithubStep {
  readonly id?: string;
  readonly name?: string;
  readonly run?: string;
  readonly uses?: string;
  readonly with?: Record<string, unknown>;
  readonly env?: Record<string, string>;
}

interface GeneratedArtifact {
  readonly path: string;
  readonly content: string;
}

interface TargetDiagnostic {
  readonly capability: string;
  readonly support: CapabilitySupport;
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly stepId?: string;
}

interface CompilationResult {
  readonly artifacts: readonly GeneratedArtifact[];
  readonly diagnostics: readonly TargetDiagnostic[];
}
```

### Exports

```ts
export { GithubTarget, compileGithub };
export type {
  GithubTargetGraph, GithubTriggers, GithubJob, GithubStep,
  GeneratedArtifact, TargetDiagnostic, CompilationResult,
};
```

## Data models

### Trigger mapping

| Sverka Trigger | GitHub Trigger |
|---|---|
| `push` | `push` (with branch filter) |
| `changeRequest` | `pull_request` (with branch filter) |
| `manual` | `workflow_dispatch` |

### Runtime mapping

| Sverka Runtime | GitHub Job |
|---|---|
| `host` (default) | `runs-on: ubuntu-latest` |
| `container` with image | `runs-on: ubuntu-latest` + `container: <image>` |

### Operation mapping

| Sverka Operation | GitHub Step |
|---|---|
| `shell` | `{ run: <command> }` |
| `exportArtifact` | `uses: actions/upload-artifact` with `path` |
| `importArtifact` | `uses: actions/download-artifact` with `name` |
| `exportOutput` | `{ run: echo "name=value" >> $GITHUB_OUTPUT }` |
| `diagnostic` | `{ run: echo "::notice\|warning\|error::message" }` |

### Dependency mapping

Step `dependencies` → job `needs` array. All dependency kinds (`control`,
`value`, and `artifact`) create `needs` because GitHub jobs can't share
values without artifacts.

### Capability manifest

```ts
const githubCapabilities: CapabilityManifest = {
  "trigger.push": "native",
  "trigger.changeRequest": "native",
  "trigger.manual": "native",
  "runtime.host": "native",
  "runtime.container": "native",
  "operation.shell": "native",
  "output.scalar": "lowered",
  "output.artifact": "native",
  "graph.dependencies": "native",
};
```

## Error handling

Custom error class `GithubTargetError` with codes:
- `INVALID_GRAPH`: graph has no pipelines or invalid structure
- `UNSUPPORTED_TRIGGER`: trigger kind not supported
- `LOWER_FAILED`: lowering failed

```ts
class GithubTargetError extends Error {
  readonly code: GithubTargetErrorCode;
  override readonly cause: unknown;
}
```

## Test plan

1. `compileGithub` with simple graph → one YAML artifact
2. Step with shell operation → job with `run:` step
3. Step with dependencies → job with `needs`
4. Push trigger → `on: push`
5. ChangeRequest trigger → `on: pull_request`
6. Manual trigger → `on: workflow_dispatch`
7. Multiple triggers → multiple `on:` entries
8. Container runtime → job with `container:`
9. Artifact output → `actions/upload-artifact` step
10. Artifact import → `actions/download-artifact` step
11. Scalar output → `$GITHUB_OUTPUT` step
12. Timeout → `timeout-minutes:`
13. `analyze` with all-native graph → no diagnostics
14. `analyze` with unsupported capability → error diagnostic
15. `lower` produces correct job count
16. `emit` produces valid YAML string
17. Deterministic output (same graph → same YAML)
18. Public API: all exports present, no any types
