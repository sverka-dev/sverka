# Spec 34 — Dagger Code Generation Target

**Status:** Active
**Source:** specs/architecture-spec.md §19 (Target Contract), §24 (Capability Model), §29 (Package Surface)
**Package:** `@sverka/compiler` (dagger sub-module)
**Capability namespace:** `dagger.*`
**Related:** ADR-016, Spec 08 (github target), Spec 09 (gitlab target)

## Overview

Compile a DefinitionGraph to a Dagger Module TypeScript file. Each step
becomes a `Container.withExec()` call. Step dependencies become
`Directory` chaining (output of one step feeds the next). The user runs
the generated module with `dagger call`. Gets free content-addressed
caching and hermeticity from Dagger.

## Goals

- `compileDagger(graph, config?): CompilationResult` — pure function,
  no network, deterministic output.
- Emit one file: `<name>.ts` (Dagger module with `@object`/`@func`
  decorators, one function per entry).
- Map shell operations → `Container.withExec(["sh", "-c", command])` (shell semantics preserved).
- Map step dependencies → `Directory` piping (build output → test input).
- Map artifacts → `Directory.export()`.
- Map scalar outputs → `container.stdout()`.
- Capability manifest declaring native/lowered/emulated/unsupported.

## Non-goals

- Executing the module (no Dagger CLI dep — ADR-016).
- Polyglot module generation (TypeScript only for v1).
- Trigger handling (Dagger has no triggers; triggers stay Sverka-side).
- Matrix expansion (generate parallel calls; no Dagger-native matrix).
- Dagger module versioning / publishing.
- Custom Dagger types (only Container, Directory, File).

## Interfaces

```ts
interface DaggerTargetConfig {
  readonly moduleName?: string;  // default: pipeline id
}

function compileDagger(
  graph: DefinitionGraph,
  config?: DaggerTargetConfig,
): CompilationResult;

class DaggerTarget implements Target {
  readonly name = "dagger";
  readonly capabilities: CapabilityManifest;
  constructor(config?: DaggerTargetConfig);
  compile(graph: DefinitionGraph): CompilationResult;
}
```

No new types exported beyond `DaggerTargetConfig`.

## Data models

### Generated module structure

```typescript
// <name>.ts
import { dag, object, func } from "@dagger.io/dagger";

@object()
export class SverkaPipeline {
  @func()
  async entrypoint(entryId: string): Promise<string> {
    let ctx = dag.git(".").tree();
    // Step: build
    ctx = ctx.withExec(["bun", "run", "build"]);
    // Step: test (depends on build — chains on same Directory)
    ctx = ctx.withExec(["bun", "test"]);
    return ctx.stdout();
  }
}
```

### Step → Dagger mapping

| Sverka | Dagger |
|---|---|
| Shell operation | `Container.withExec(["sh", "-c", command])` |
| Dependency (control) | Chain on same `Directory` |
| Dependency (artifact) | Chain on same `Directory` (build output → test input) |
| Condition | `if`/`else` in generated function |
| Matrix | `for` loop with parallel `withExec` calls |
| RetryPolicy | TypeScript retry wrapper around `withExec` |
| Timeout | `Container.withTimeout()` |
| Runtime container | Native (Dagger IS container execution) |
| Runtime host | Unsupported (diagnostic) |
| Scalar output | `container.stdout()` |
| Artifact output | `Directory.export()` |

### Capability manifest

```ts
const daggerCapabilities: CapabilityManifest = {
  "graph.dependencies": "native",
  "graph.conditions": "emulated",
  "graph.matrix": "emulated",
  "operation.shell": "native",
  "output.scalar": "native",
  "output.artifact": "native",
  "policy.retry": "emulated",
  "policy.timeout": "native",
  "trigger.push": "unsupported",
  "trigger.changeRequest": "unsupported",
  "trigger.manual": "unsupported",
  "trigger.schedule": "unsupported",
  "runtime.host": "unsupported",
  "runtime.container": "native",
  "agent.step": "emulated",
};
```

## Error handling

`DaggerTargetError` with `override readonly cause: unknown`. Codes:
- `INVALID_GRAPH` — no pipelines or no entries.
- `LOWER_FAILED` — step lowering error.
- `EMIT_FAILED` — code generation error.
- `UNSUPPORTED_RUNTIME` — host runtime step in graph (diagnostic, not
  error — emitted as warning, step skipped in generated code).

## Test plan

1. Empty graph → `INVALID_GRAPH` error.
2. Single-step graph → module with one `withExec` call.
3. Two-step graph with dependency → chained `withExec` on same Directory.
4. Diamond dependency → correct Directory piping.
5. Artifact output → `Directory.export()` in generated code.
6. Scalar output → `container.stdout()` in generated code.
7. Host runtime → unsupported diagnostic.
8. Container runtime → native (no diagnostic).
9. RetryPolicy → TypeScript retry wrapper in generated code.
10. Timeout → `Container.withTimeout()` in generated code.
11. Matrix → for-loop with parallel calls.
12. Condition → if/else in generated function body.
13. Generated module code is valid TypeScript (structural assertions).
14. Determinism: same graph → identical output.
15. Capability manifest exported and correct.
16. Public API: `compileDagger` + `DaggerTarget` + types exported.
