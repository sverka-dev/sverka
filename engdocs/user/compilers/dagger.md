# Dagger compiler target

> **Work in progress.** The Dagger compiler generates a Dagger Module
> TypeScript file. You run it with `dagger call`. APIs may change.

The `@sverka/compiler` Dagger sub-module compiles a DefinitionGraph to a
Dagger Module TypeScript file. Each step becomes a `Container.withExec()`
call. Step dependencies become `Container` chaining — steps share a mounted
`/src` directory, so build output persists for the next step. You get free
content-addressed caching and hermeticity from Dagger.

## Usage

```ts
import { compileDagger } from "@sverka/compiler";
import { createSverka } from "@sverka/sdk";

const sverka = createSverka({ root: process.cwd() });
const graph = await sverka.toGraph();

const result = compileDagger(graph, {
  name: "my-pipeline",
  baseImage: "node:24",
});

// result.artifacts: [{ path: "my-pipeline.ts", content: "..." }]
```

## What gets generated

- **`<name>.ts`** — Dagger module with `@object`/`@func` decorators, one
  function per entry. Shell operations map to
  `Container.withExec(["sh", "-c", command])`. Artifacts map to
  `Directory.export()`. Scalar outputs map to `container.stdout()`.

## Capability mapping

| Sverka feature | Dagger mapping |
|----------------|---------------|
| Shell operations | `Container.withExec(["sh", "-c", cmd])` |
| Step dependencies | `Container` chaining (shared `/src` mount) |
| Artifacts | `Directory.export()` |
| Scalar outputs | `container.stdout()` |
| Runtime container | Base image selection |
| Triggers | None (Dagger has no triggers — stay Sverka-side) |
| Matrix | Parallel calls (no Dagger-native matrix) |
| Retry | Manual retry in generated code |

## What you need to provide

- The Dagger CLI installed locally or in CI.
- Run the generated module with `dagger call <function>`.
