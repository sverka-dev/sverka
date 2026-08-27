<div align="center">

# Sverka

### Define checks once. Plan locally. Run anywhere.

A provider-neutral workflow framework and execution platform for software
verification. Author workflows in TypeScript, execute them locally, and
compile the same definition to GitHub Actions or GitLab CI.

> **⚠️ Work in progress — pre-alpha.** Sverka is under active development.
> Not ready for production use. APIs may change without notice. The compiler
> packages currently emit thin-wrapper CI YAML (a single job that runs
> `sverka execute`); native one-job-per-step lowering is planned. The SDK
> builder composables (`sh`, `artifact`, `images`) are not yet shipped.

[Website](https://sverka.dev) &middot; [Documentation](https://sverka.dev/docs) &middot; [CLI Reference](https://sverka.dev/docs/cli)

</div>

---

## What is Sverka?

Sverka lets you define verification workflows as TypeScript code through
three equivalent authoring surfaces, execute them locally through a native
engine, and compile the same Definition Graph to GitHub Actions or GitLab CI.

The canonical source of truth is the **Definition Graph** — a provider-neutral
intermediate representation. Not GitHub Actions YAML. Not GitLab CI YAML.
Your workflow, defined once, lowered everywhere.

```ts
import { Project, Pipeline, ShellStep, Entry } from "@sverka/cdk";

const proj = new Project("verify");
const p = new Pipeline(proj, "ci");

new ShellStep(p, "lint", { command: "npm run lint" });
new ShellStep(p, "build", { command: "npm run build", dependsOn: ["lint"] });
new ShellStep(p, "test", { command: "npm run test", dependsOn: ["build"] });

new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["test"] });

export default proj;
```

The same workflow can be:

- **Authored** through Construct or Decorator APIs — both produce the same graph
- **Executed locally** through the native engine with host or container runtime
- **Planned** without executing — see what will run before it runs
- **Compiled** to GitHub Actions or GitLab CI YAML
- **Serialized** for deterministic replay and distribution

## Two authoring surfaces

Both produce the **same Definition Graph**:

### Construct API

```ts
import { Project, Pipeline, ShellStep, Entry } from "@sverka/cdk";

const proj = new Project("myproj");
const p = new Pipeline(proj, "ci");
new ShellStep(p, "build", { command: "npm run build" });
new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
```

### Decorator API

```ts
import { pipeline, step, entry, decoratePipeline } from "@sverka/decorators";
import { Project } from "@sverka/cdk";

@pipeline
class MyPipeline {
  @step build = "npm run build";
  @entry({ kind: "push" }) ["on-push"] = ["build"];
}

const proj = new Project("myproj");
decoratePipeline(MyPipeline, proj, "ci");
```

> **Planned:** an SDK builder API (`sh`, `artifact`, `when`, `images`) is
> designed but not yet shipped.

## Features

- **Two authoring surfaces** — Construct and Decorator APIs produce equivalent graphs (SDK builder API planned)
- **Provider-neutral Definition Graph** — no GitHub or GitLab terms in your workflow
- **Native engine** — topological scheduling, parallel steps, failure propagation
- **CI compilation** — compile the Plan to GitHub Actions or GitLab CI YAML (thin-wrapper mode today; native lowering planned)
- **Automatic discovery** — zero-config project detection
- **Run Plan binding** — select entries, provide inputs, get a bound plan
- **Serialization** — serialize and deserialize graphs for distribution
- **Normalized findings** — one model for all tool outputs
- **Policy engine** — decide what fails and what passes

## Quick start

```bash
# Install
bun add -g @sverka/cli

# Initialize in your project
sverka init

# Validate the Definition Graph
sverka validate

# See the graph
sverka graph

# Run verification locally
sverka run

# Compile to GitHub Actions
sverka compile --target github --output .github/workflows/sverka.yml

# Compile to GitLab CI
sverka compile --target gitlab --output .gitlab-ci.yml
```

> **Note:** `sverka synth` exists as a stub but is not implemented. Use
> `sverka compile` instead.

## Architecture

```text
  ┌──────────────────────────────────────────────┐
  │           Authoring Surfaces                 │
  │  Constructs  │  SDK  │  Decorators           │
  └──────────────────┬───────────────────────────┘
                     │ synthesize
  ┌──────────────────▼───────────────────────────┐
  │          Definition Graph (IR)               │
  │  Project → Pipeline → Steps / Entries        │
  └──────┬──────────────────────────┬────────────┘
         │                          │ lower
  ┌──────▼──────────┐    ┌──────────▼──────────┐
  │   Run Plan      │    │   Target Graphs     │
  │   (bound)       │    │  GitHub │ GitLab    │
  └──────┬──────────┘    └──────────┬──────────┘
         │ execute                  │ emit
  ┌──────▼──────────┐    ┌──────────▼──────────┐
  │  Native Engine  │    │   YAML Artifacts    │
  │  Host/Container │    │  .github/workflows  │
  └──────┬──────────┘    │  .gitlab-ci.yml     │
         │               └─────────────────────┘
  ┌──────▼──────────┐
  │  Run Events     │
  │  + Findings     │
  └─────────────────┘
```

## Packages

| Package | Description |
|---------|-------------|
| `@sverka/cdk` | Construct API: Project, Pipeline, ShellStep, Entry |
| `@sverka/decorators` | Decorator API: @pipeline, @step, @entry, @input |
| `@sverka/sdk` | SDK entry point (createSverka) and core re-exports; builder API planned |
| `@sverka/core` | Definition Graph synthesis and validation |
| `@sverka/ir` | Serializable graph schema, Plan, Run Plan, validation |
| `@sverka/planner` | Discovery, Run Plan binding |
| `@sverka/engine-native` | Native execution engine, scheduler |
| `@sverka/runtime-host` | Host process runtime driver |
| `@sverka/runtime-docker` | Docker container runtime driver |
| `@sverka/runtime-podman` | Podman container runtime driver |
| `@sverka/compiler-github` | Compile Plan → GitHub Actions YAML |
| `@sverka/compiler-gitlab` | Compile Plan → GitLab CI YAML |
| `@sverka/checks` | Built-in check providers |
| `@sverka/findings` | SARIF normalization, fingerprints, baselines |
| `@sverka/policy` | Policy evaluation |
| `@sverka/conformance` | Conformance suite |
| `@sverka/cli` | Command-line interface |

## Development

```bash
# Prerequisites: Bun >= 1.1, Node.js >= 24

bun install        # install dependencies
bun run build      # build all packages (tsdown via nx)
bun run test       # run all tests (vitest via nx); NOTE: `bun test` runs Bun's built-in runner, not vitest
bun run lint       # lint all packages (eslint)
bun run typecheck  # typecheck all packages
```

### Tech stack

- **Language:** TypeScript (strict, ESM)
- **Package manager:** Bun
- **Monorepo:** Nx
- **Build:** tsdown
- **Test:** Vitest
- **Lint:** ESLint
- **Format:** Prettier

## Project structure

```text
packages/     # monorepo packages
specs/        # numbered spec tree (spec-driven development)
engdocs/      # engineering docs (architecture, ADRs, contributing)
website/      # sverka.dev website
```

## v0 redesign

The v0 redesign rebuilt Sverka from the ground up as a provider-neutral
workflow framework. Key changes:

- **Definition Graph** replaces the old Plan IR as the canonical source
- **Two authoring surfaces** (Construct/Decorator) replace the old single SDK (builder API planned)
- **CI compilation** via `@sverka/compiler-github` and `@sverka/compiler-gitlab` — thin-wrapper mode today (single job running `sverka execute`), native one-job-per-step lowering planned
- **Conformance suite** verifies all surfaces produce equivalent graphs

The v0 redesign was organized in waves:

| Wave | Description |
|------|-------------|
| A | Construct API |
| B | IR schemas |
| C | SDK authoring |
| D | Decorator authoring |
| E | Plugin/capability model |
| F | Native engine/runtime drivers |
| G | Planner |
| H | GitHub native target |
| I | GitLab native target |
| J | Checks integration |
| K | Findings/policy carry-over |
| L | CLI |
| M | Conformance suite (§34 acceptance gate) |
| N | Documentation |

## Contributing

See [Contributor Guide](engdocs/contributing/guide.md) for development setup
and conventions. The project uses spec-driven development (SDD) and test-driven
development (TDD), organized in waves.

## License

[MIT](LICENSE) &middot; Copyright (c) 2026 sverka.dev
