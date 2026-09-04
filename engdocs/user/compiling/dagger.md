# Dagger compiler target

> **Work in progress.** The Dagger compiler generates a Dagger Module
> TypeScript file. You run it with `dagger call`. APIs may change.

The `@sverka/compiler` Dagger sub-module compiles a DefinitionGraph to a
Dagger Module TypeScript file. Each step becomes a `Container.withExec()`
call. Step dependencies become `Container` chaining — steps share a mounted
`/src` directory, so build output persists for the next step. You get free
content-addressed caching and container isolation from Dagger.

## Usage

```ts
import { Project, Pipeline, ShellStep, Entry } from "@sverka/workflow";
import { synthesize } from "@sverka/workflow";
import { compileDagger } from "@sverka/compiler";

const proj = new Project("myproj");
const p = new Pipeline(proj, "ci");
new ShellStep(p, "lint", { command: "npm run lint" });
new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["lint"] });

const graph = synthesize(proj);

const result = compileDagger(graph, {
  moduleName: "my-pipeline",
});

// result.artifacts: [{ path: "my-pipeline.ts", content: "..." }]
```

## What gets generated

- **`<name>.ts`** — Dagger module with `@object`/`@func` decorators,
  a single function for the first entry. Shell operations map to
  `Container.withExec(["sh", "-c", command])`. Artifacts and scalar
  outputs are unsupported and emit diagnostics.

## Capability mapping

| Sverka feature | Dagger mapping |
|----------------|---------------|
| Shell operations | `Container.withExec(["sh", "-c", cmd])` |
| Step dependencies | `Container` chaining (shared `/src` mount) |
| Artifacts | Unsupported (diagnostic) |
| Scalar outputs | Unsupported (diagnostic) |
| Runtime container | Base image selection |
| Triggers | None (Dagger has no triggers — stay Sverka-side) |
| Matrix | Sequential calls (matrix is emulated, not parallelized) |
| Retry | Manual retry in generated code |

## What you need to provide

- The Dagger CLI installed locally or in CI.
- Run the generated module with `dagger call <function>`.
