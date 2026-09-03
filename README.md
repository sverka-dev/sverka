<div align="center">

# Sverka

### AI-friendly workflow runtime. Define in TypeScript. Run locally. Compile anywhere.

A portable workflow runtime — code-defined workflows with local execution
and optional multi-target compilation. Author workflows in TypeScript, run
them locally through a native engine, and compile the same definition to
GitHub Actions, GitLab CI, Temporal, Dagger, or Inngest. No external
infrastructure required — the runtime is a single process.

AI agents use Sverka through a skill or the CLI. One command replaces
dozens of tool-call round-trips. Optional MCP server exposes Sverka as
tools for any MCP-compatible client.

> **⚠️ Work in progress — pre-alpha.** Sverka is under active development.
> Not ready for production use. APIs may change without notice. The SDK
> builder API (`$`, `shell`, `agent` tagged templates) is designed but
> not yet shipped. Native one-job-per-step CI lowering is planned.

[Website](https://sverka.dev) &middot; [Documentation](https://sverka.dev/docs) &middot; [Agent Integration](https://sverka.dev/docs/user/agent-integration/skill-cli/)

</div>

---

## What is Sverka?

Sverka lets you define workflows as TypeScript code through the Construct
API, execute them locally through a native engine, and compile the same
Definition Graph to GitHub Actions, GitLab CI, Temporal, Dagger, or Inngest.

The canonical source of truth is the **Definition Graph** — a provider-neutral
intermediate representation. Not GitHub Actions YAML. Not GitLab CI YAML.
Not Temporal workflow code. Your workflow, defined once, lowered everywhere.

```ts
import { Project, Pipeline, ShellStep, Entry } from "@sverka/workflow";

const proj = new Project("ci");
const p = new Pipeline(proj, "ci");

new ShellStep(p, "lint", { command: "npm run lint" });
new ShellStep(p, "build", { command: "npm run build", dependsOn: ["lint"] });
new ShellStep(p, "test", { command: "npm run test", dependsOn: ["build"] });

new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["test"] });

export default proj;
```

The same workflow can be:

- **Authored** through the Construct API
- **Executed locally** through the native engine with host or container runtime
- **Planned** without executing — see what will run before it runs
- **Compiled** to GitHub Actions or GitLab CI YAML
- **Serialized** for deterministic replay and distribution

## Authoring surface

The Construct API produces the **same Definition Graph**:

### Construct API

```ts
import { Project, Pipeline, ShellStep, Entry } from "@sverka/workflow";

const proj = new Project("myproj");
const p = new Pipeline(proj, "ci");
new ShellStep(p, "build", { command: "npm run build" });
new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
```

> **Planned:** an SDK builder API (`$`, `shell`, `artifact`, `when`) is
> designed but not yet shipped.

## Features

- **Construct API** — author workflows in TypeScript (SDK builder API planned)
- **Provider-neutral Definition Graph** — no target-specific terms in your workflow
- **Local-first execution** — run the same graph on host or container, no external infra
- **Multi-target compilation** — compile to GitHub Actions or GitLab CI via CLI; Temporal, Dagger, Inngest, and Drone via @sverka/compiler library
- **Agent-friendly** — skill + CLI with `--format json` on every command
- **MCP server** — expose Sverka as MCP tools for any MCP-compatible client
- **MCP plugin** — workflows can call external MCP servers as tools
- **AgentStep** — AI agent as a step type (stub driver shipped, real drivers planned)
- **Suspend/resume** — pause runs for external input, resume with data
- **Saga compensations** — automatic rollback of succeeded steps on failure
- **Automatic discovery** — zero-config project detection
- **Run Plan binding** — select entries, provide inputs, get a bound plan
- **Serialization** — serialize and deserialize graphs for distribution
- **Optional verification profile** — built-in checks, normalized findings, and policy evaluation

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

# Run the workflow locally
sverka run

# Compile to GitHub Actions
sverka synth --target github --output .github/workflows/sverka.yml

# Compile to GitLab CI
sverka synth --target gitlab --output .gitlab-ci.yml
```

> **Note:** `sverka synth` is currently a stub — target compilation is
> not yet implemented. The `@sverka/compiler` library exposes
> `compileGithub` and `compileGitlab` for programmatic use.

## Architecture

```text
  ┌──────────────────────────────────────────────┐
  │           Authoring Surfaces                 │
  │  Constructs  │  SDK (planned)                │
  └──────────────────┬───────────────────────────┘
                     │ synthesize
  ┌──────────────────▼───────────────────────────┐
  │          Definition Graph (IR)               │
  │  Project → Pipeline → Steps / Entries        │
  └──────┬──────────────────────────┬────────────┘
         │                          │
         │ bind                     │ lower
  ┌──────▼──────────┐    ┌──────────▼──────────┐
  │   Run Plan      │    │   Target Compilers  │
  │   (local)       │    │  GitHub │ GitLab    │
  └──────┬──────────┘    │  Temporal │ Dagger   │
         │ execute       │  Inngest │ Drone    │
  ┌──────▼──────────┐    └──────────┬──────────┘
  │  Native Engine  │               │ emit
  │  Host/Container │    ┌──────────▼──────────┐
  └──────┬──────────┘    │   Target Artifacts   │
         │               │  .github/workflows   │
  ┌──────▼──────────┐    │  .gitlab-ci.yml      │
  │  Run Events     │    │  *.workflow.ts       │
  └─────────────────┘    └─────────────────────┘
         │
         │ (optional)
  ┌──────▼──────────┐
  │  Findings /     │
  │  Policy         │
  └─────────────────┘

  Agent Integration:
  ┌──────────────────────────────────────────────┐
  │  Skill + CLI (--format json)  ←  AI agents   │
  │  MCP server (sverka mcp-server)              │
  │  MCP plugin (load external MCP servers)      │
  └──────────────────────────────────────────────┘
```

## Packages

| Package | Description |
|---------|-------------|
| `@sverka/workflow` | Workflow definition: Construct API, Definition Graph, Plan IR, validation |
| `@sverka/runtime` | Execution runtime: scheduler, native engine, host & Docker drivers |
| `@sverka/compiler` | Target compilation: GitHub Actions, GitLab CI, Temporal, Dagger, Inngest, Drone |
| `@sverka/sdk` | Public TypeScript API (createSverka), planner, builder API planned |
| `@sverka/verification` | Optional profile: findings, policy, built-in checks |
| `@sverka/cli` | Command-line interface (includes `sverka mcp-server`) |
| `@sverka/plugin-mcp` | MCP plugin: load external MCP servers as Sverka plugins |

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
workflow framework and portable runtime. Key changes:

- **Definition Graph** replaces the old Plan IR as the canonical source
- **Single authoring surface** (Construct) replaces the old SDK (builder API planned)
- **CI compilation** via `@sverka/compiler` (GitHub Actions and GitLab CI) — thin-wrapper mode today (single job running `sverka execute`), native one-job-per-step lowering planned
- **Conformance coverage** is maintained by package test suites

The v0 redesign was organized in waves:

| Wave | Description |
|------|-------------|
| A | Construct API |
| B | IR schemas |
| C | SDK authoring |

| E | Plugin/capability model |
| F | Native engine/runtime drivers |
| G | Planner |
| H | GitHub native target |
| I | GitLab native target |
| J | Checks integration |
| K | Findings/policy carry-over |
| L | CLI |

| N | Documentation |

## Contributing

See [Contributor Guide](engdocs/contributing/guide.md) for development setup
and conventions. The project uses spec-driven development (SDD) and test-driven
development (TDD), organized in waves.

## License

[MIT](LICENSE) &middot; Copyright (c) 2026 sverka.dev
