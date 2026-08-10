<div align="center">

# Sverka

### Define checks once. Plan locally. Run anywhere.

A composable workflow SDK, local CI runtime, and multi-target compiler
for software verification.

[Website](https://sverka.dev) &middot; [Documentation](https://sverka.dev/docs) &middot; [CLI Reference](https://sverka.dev/docs/cli)

</div>

---

## What is Sverka?

Sverka lets you define verification workflows as TypeScript code, execute
them locally using Docker or Podman, generate a plan before execution, and
compile the same workflow to GitHub Actions, GitLab CI, and other targets.

The canonical source of truth is the Sverka workflow and its intermediate
representation — not GitHub Actions or GitLab CI.

```ts
import { pipeline, run, parallel } from "@sverka/sdk";
import { build, lint, test, securityScan } from "@sverka/checks";

export default pipeline("verify", async ({ run, parallel }) => {
  const artifact = await run(build());

  await parallel(
    run(lint({ input: artifact })),
    run(test({ input: artifact })),
    run(securityScan({ input: artifact })),
  );
});
```

The same workflow can be:

- **Executed locally** using Docker, Podman, or host processes
- **Planned** without executing — see what will run before it runs
- **Compiled** to GitHub Actions, GitLab CI, or Earthly
- **Replayed** from a locked plan for deterministic reproduction

## Features

- **TypeScript-first API** — composable workflows as code
- **Local execution** — Docker, Podman, host processes, remote APIs
- **Automatic discovery** — zero-config project detection
- **Verification plan** — generate a plan before execution
- **Multi-target compilation** — one workflow, many CI targets
- **Normalized findings** — one model for all tool outputs
- **Policy engine** — decide what fails and what passes
- **Deterministic replay** — locked images, locked inputs, reproducible runs
- **Caching** — operation-level, image-level, dependency-level
- **Parallelism** — max local parallelism with topological scheduling

## Quick start

```bash
# Install
bun add -g @sverka/cli

# Initialize in your project
sverka init

# Run verification locally
sverka run

# See what would run without executing
sverka plan --explain

# Compile to GitHub Actions
sverka compile --target github

# Compile to GitLab CI
sverka compile --target gitlab
```

## Architecture

```text
                 ┌─────────────────────┐
                 │ Workflow SDK / DSL  │
                 └──────────┬──────────┘
                            │
                 ┌──────────▼──────────┐
                 │ Discovery + Planner  │
                 └──────────┬──────────┘
                            │
                 ┌──────────▼──────────┐
                 │ Canonical Plan IR   │
                 └──────┬───────┬───────┘
                        │       │
        ┌───────────────▼─┐   ┌─▼────────────────┐
        │ Local Executors  │   │ Target Compilers │
        ├──────────────────┤   ├─────────────────┤
        │ Docker           │   │ GitHub Actions  │
        │ Podman           │   │ GitLab CI       │
        │ Host             │   │ Earthly         │
        │ Remote API       │   │                 │
        └────────┬─────────┘   └────────┬────────┘
                 │                      │
                 └──────────┬───────────┘
                            │
                 ┌──────────▼──────────┐
                 │ Findings + Verdict  │
                 └─────────────────────┘
```

## Packages

| Package | Description |
|---------|-------------|
| `@sverka/sdk` | Public TypeScript API |
| `@sverka/core` | Workflow graph, operations, outputs |
| `@sverka/ir` | Canonical plan schema and validation |
| `@sverka/runtime` | Executor interfaces and scheduler |
| `@sverka/runtime-docker` | Docker executor |
| `@sverka/runtime-podman` | Podman executor |
| `@sverka/runtime-host` | Host process executor |
| `@sverka/runtime-remote` | GitHub/GitLab/SonarCloud API checks |
| `@sverka/planner` | Discovery and plan synthesis |
| `@sverka/findings` | Normalization, fingerprints, baseline |
| `@sverka/policy` | Policy evaluation |
| `@sverka/checks` | Built-in check providers |
| `@sverka/compiler-github` | GitHub Actions compiler |
| `@sverka/compiler-gitlab` | GitLab CI compiler |
| `@sverka/compiler-earthly` | Earthly compiler |
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

## Roadmap

### Phase 1 — Core local runner

- TypeScript SDK (`pipeline`, `run`, `parallel`)
- Plan IR
- Docker executor
- Host executor
- Console/JSON reports
- Topological scheduler
- Timeout and retry
- Basic cache

### Phase 2 — Verification platform

- Podman executor
- Plugin descriptors
- Project discovery
- Semgrep, Trivy, Gitleaks, ESLint, tests
- SARIF normalization
- Baseline and policy engine

### Phase 3 — Portable CI

- GitHub Actions wrapper compiler
- GitLab CI wrapper compiler
- Generated plan artifact
- `gh act` compatibility
- `gitlab-ci-local` compatibility

### Phase 4 — Native compilers and durability

- Native GitHub job expansion
- Native GitLab job expansion
- Dagger/Earthly adapters
- Resumable local execution
- Remote execution protocol

## Contributing

See [Contributor Guide](engdocs/contributing/guide.md) for development setup
and conventions. The project uses spec-driven development (SDD) and test-driven
development (TDD), organized in waves.

## License

[MIT](LICENSE) &middot; Copyright (c) 2026 sverka.dev
