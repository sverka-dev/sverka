# Spec 09 — Target gitlab (native lowering)

**Status:** Active
**Source:** specs/architecture-spec.md §18.2, §19, §31.3, §32
**Package:** `@sverka/gitlab` (new)

## Overview

The GitLab target performs native lowering from a Definition Graph to
GitLab CI YAML. It implements the Target contract (§19): analyze →
lower → emit. Same pattern as Wave H (GitHub) but for GitLab CI:
jobs, stages, needs, image, script, artifacts, rules.

## Goals

- `GitlabTarget` implementing the Target interface (§19)
- `analyze(graph)` → diagnostics via capability analysis
- `lower(graph)` → GitlabTargetGraph (intermediate representation)
- `emit(targetGraph)` → GeneratedArtifact[] (YAML files)
- One GitLab job per Step
- Step dependencies → job `needs`
- Runtime mode → `image` (host → default, container → image:)
- Shell operations → `script:` entries
- Artifact outputs → `artifacts:` paths
- Artifact imports → `needs` (artifact producers are also scheduling dependencies)
- Scalar outputs → writing to `sverka.env` dotenv report file
- Trigger mapping: push→rules with if $CI_PIPELINE_SOURCE=="push", changeRequest→rules with if for merge_request_event, manual→rules with if for web
- Stages derived from dependency graph topological order
- Capability manifest declaring GitLab support levels
- Deterministic output

## Non-goals

- Matrix expansion (§32 — deferred)
- Cache (§32 — deferred)
- Services (§32 — deferred)
- Schedule triggers (§32 — deferred)
- Retry policy (§32 — deferred)
- GitLab importer (§32 — deferred)
- Provider-native actions in portable core (§32 — deferred)

## Interfaces

```ts
class GitlabTarget implements Target {
  readonly name = "gitlab";
  readonly capabilities: CapabilityManifest;
  analyze(graph: DefinitionGraph): readonly TargetDiagnostic[];
  lower(graph: DefinitionGraph): GitlabTargetGraph;
  emit(targetGraph: GitlabTargetGraph): readonly GeneratedArtifact[];
  compile(graph: DefinitionGraph): CompilationResult;
}

function compileGitlab(graph: DefinitionGraph): CompilationResult;
```

### GitlabTargetGraph

```ts
interface GitlabTargetGraph {
  readonly name: string;
  readonly stages: readonly string[];
  readonly jobs: readonly GitlabJob[];
  readonly variables: Record<string, string>;
}

interface GitlabArtifactSpec {
  readonly paths?: readonly string[];
  readonly reports?: {
    readonly dotenv?: string;
  };
}

interface GitlabJob {
  readonly id: string;
  readonly stage: string;
  readonly image?: string;
  readonly needs: readonly string[];
  readonly script: readonly string[];
  readonly artifacts?: GitlabArtifactSpec;

  readonly variables?: Record<string, string>;
  readonly rules?: readonly GitlabRule[];
  readonly timeout?: string;
}

interface GitlabRule {
  readonly if: string;
  readonly when?: string;
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
export { GitlabTarget, compileGitlab };
export type {
  GitlabTargetGraph, GitlabJob, GitlabRule,
  GeneratedArtifact, TargetDiagnostic, CompilationResult,
};
```

## Data models

### Trigger mapping

| Sverka Trigger | GitLab Rule |
|---|---|
| `push` | `if: $CI_PIPELINE_SOURCE == "push"` (plus branch filter when present) |
| `changeRequest` | `if: $CI_PIPELINE_SOURCE == "merge_request_event"` (plus branch filter when present) |
| `manual` | `if: $CI_PIPELINE_SOURCE == "web"` |

### Runtime mapping

| Sverka Runtime | GitLab Job |
|---|---|
| `host` (default) | no `image:` (uses runner default) |
| `container` with image | `image: <image>` |

### Operation mapping

| Sverka Operation | GitLab Job |
|---|---|
| `shell` | `script:` entry |
| `exportArtifact` | `artifacts:` paths |
| `importArtifact` | `needs` (artifact producer) |
| `exportOutput` | `script: echo "name=value" >> sverka.env` + `artifacts: reports: dotenv: sverka.env` |
| `diagnostic` | `script: echo "message"` (shell-escaped) |

### Stage assignment

Stages are derived from the dependency graph. Steps with no dependencies
go into `build` stage. Steps that depend on other steps go into a stage
named after their dependency depth (e.g., `stage-1`, `stage-2`). For
simplicity in v0, stages are assigned by topological level:
- Level 0: `build`
- Level N: `stage-N`

### Capability manifest

```ts
const gitlabCapabilities: CapabilityManifest = {
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

Custom error class `GitlabTargetError` with codes:
- `INVALID_GRAPH`: graph has no pipelines or invalid structure
- `UNSUPPORTED_TRIGGER`: trigger kind not supported
- `LOWER_FAILED`: lowering failed

```ts
class GitlabTargetError extends Error {
  readonly code: GitlabTargetErrorCode;
  override readonly cause: unknown;
}
```

## Test plan

1. `compileGitlab` with simple graph → one YAML artifact
2. Step with shell operation → job with `script:`
3. Step with dependencies → job with `needs`
4. Push trigger → rules with `$CI_PIPELINE_SOURCE == "push"`
5. ChangeRequest trigger → rules with `merge_request_event`
6. Manual trigger → rules with `web`
7. Multiple triggers → multiple rules
8. Container runtime → job with `image:`
9. Artifact output → `artifacts:` paths
10. Artifact import → `dependencies:` + `needs`
11. Scalar output → `.env` script entry
12. Timeout → `timeout:` string
13. `analyze` with all-native graph → no diagnostics
14. `lower` produces correct job count
15. `emit` produces valid YAML string
16. Deterministic output (same graph → same YAML)
17. Stages assigned by topological level
18. Public API: all exports present, no any types
