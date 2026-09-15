<div align="center">

# Sverka

## Define checks once. Run locally. Compile anywhere.

A local-first workflow runtime for code-defined checks. Author your
lint, typecheck, test, and build steps as a single TypeScript config.
Run them with one command — `sverka run`. No external infrastructure,
no per-tool orchestration, no YAML.

AI agents use Sverka through a skill or the CLI. One command replaces
dozens of tool-call round-trips. Optional MCP server exposes Sverka as
tools for any MCP-compatible client.

[Website](https://sverka.dev) &middot; [Documentation](https://sverka.dev/docs) &middot; [Agent Integration](https://sverka.dev/docs/user/agent-integration/skill-cli/)

</div>

---

## What is Sverka?

Sverka lets you define checks as TypeScript code through the Construct
API and run them locally through a native engine. One config, one
command, one report.

The canonical source of truth is the **Definition Graph** — a
provider-neutral intermediate representation. Your checks, defined once,
run the same way on your laptop, in CI, or in a container.

```ts
import { Project, Pipeline, ShellStep, Entry, push } from "@sverka/workflow";

const proj = new Project("ci");
const p = new Pipeline(proj, "ci");

new ShellStep(p, "lint", { command: "npm run lint" });
new ShellStep(p, "typecheck", { command: "npm run typecheck" });
new ShellStep(p, "test", {
  command: "npm run test",
  dependencies: [{ kind: "control", producer: "lint" }],
});

new Entry(p, "on-push", { trigger: push(), roots: ["lint", "typecheck", "test"] });

export default proj;
```

The same workflow can be:

- **Authored** through the Construct API
- **Executed locally** through the native engine with host or container runtime
- **Planned** without executing — see what will run before it runs
- **Compiled** to GitHub Actions or GitLab CI YAML (optional)
- **Serialized** for deterministic replay and distribution

## Features

- **Construct API** — author workflows in TypeScript
- **Local-first execution** — run the same graph on host or container, no external infra
- **Automatic discovery** — zero-config project detection
- **Run Plan binding** — select entries, provide inputs, get a bound plan
- **Agent-friendly** — skill + CLI with `--format json` on every command
- **MCP server** — expose Sverka as MCP tools for any MCP-compatible client
- **MCP plugin** — workflows can call external MCP servers as tools
- **AgentStep** — AI agent as a step type
- **Suspend/resume** — pause runs for external input, resume with data
- **Saga compensations** — automatic rollback of succeeded steps on failure
- **Serialization** — serialize and deserialize graphs for distribution
- **Optional verification profile** — built-in checks, normalized findings, and policy evaluation
- **Optional CI compilation** — compile to GitHub Actions, GitLab CI, Temporal, Dagger, Inngest, or Drone

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

# Run all checks locally
sverka run

# Compile to GitHub Actions (optional)
sverka compile --target github --output .github/workflows/sverka.yml

# Compile to GitLab CI (optional)
sverka compile --target gitlab --output .gitlab-ci.yml
```

## Architecture

```text
  ┌──────────────────────────────────────────────┐
  │           Authoring Surface                  │
  │  Construct API (TypeScript)                  │
  └──────────────────┬───────────────────────────┘
                     │ synthesize
  ┌──────────────────▼───────────────────────────┐
  │          Definition Graph (IR)               │
  │  Project → Pipeline → Steps / Entries        │
  └──────┬──────────────────────────┬────────────┘
         │                          │
         │ bind                     │ lower (optional)
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
  │  Run Events     │    └─────────────────────┘
  └─────────────────┘
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
| `@sverka/sdk` | Public TypeScript API (createSverka), planner |
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

## Contributing

See [Contributor Guide](engdocs/contributing/guide.md) for development setup
and conventions. The project uses spec-driven development (SDD) and test-driven
development (TDD), organized in waves.

## License

[MIT](LICENSE) &middot; Copyright (c) 2026 sverka.dev
