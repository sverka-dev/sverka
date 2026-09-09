# Concepts

Sverka is a framework for running local checks. This page explains what
that means, what problems it solves, and how it fits into your workflow.

## The problem

Running checks locally is messy:

- **Ad-hoc scripts.** You write `bun run lint && bun run typecheck && bun run test`
  in a shell script or a Makefile. No structure, no dependencies, no findings.
- **Tool sprawl.** ESLint, Semgrep, CodeQL, SonarCloud — each produces output
  in its own format. No unified way to collect, filter, or view findings.
- **CI-only.** Most teams define checks only in CI YAML. Local runs are
  manual and unreliable. You find problems late — at push time, not at
  write time.
- **Agent friction.** AI agents run tools one by one, parsing unstructured
  output. Dozens of tool-call round-trips. High token cost. Fragile.

## The Sverka approach

Sverka treats checks as first-class code:

```ts
import { Project, Pipeline, ShellStep, Entry } from "@sverka/workflow";

const proj = new Project("my-project");
const checks = new Pipeline(proj, "checks");

new ShellStep(checks, "typecheck", { command: "bun run typecheck" });
new ShellStep(checks, "lint",      { command: "bun run lint", dependencies: [{ kind: "control", producer: "typecheck" }] });
new ShellStep(checks, "test",      { command: "bun run test", dependencies: [{ kind: "control", producer: "lint" }] });

new Entry(checks, "on-push", { trigger: { kind: "push" }, roots: ["test"] });

export default proj;
```

This gives you:

1. **Structure.** Checks have names, dependencies, and explicit ordering.
   The engine resolves the DAG, runs steps in parallel where possible,
   and handles failures gracefully.

2. **Findings.** Every check can produce SARIF findings. Sverka normalizes
   them into a unified `Finding[]` with stable fingerprints, severities,
   and file locations. No more parsing raw tool output.

3. **Local-first.** `sverka run` executes the full workflow locally.
   No cloud, no remote API, no Temporal server. The runtime is a single
   process. You get findings immediately — not at push time.

4. **Structured output.** `--format json` returns machine-readable results.
   `--format sarif` writes a SARIF file. `--format web` generates an HTML
   report. `sverka view` opens an interactive TUI. `sverka ui` starts a
   local web dashboard.

5. **CI optional.** The same definition compiles to GitHub Actions or
   GitLab CI. CI is one deployment target — not the only way to run checks.

## Design principles

- **Code-defined.** Workflows are TypeScript, not YAML. Type safety,
  composition, and IDE support come for free.
- **Local-first.** Everything runs in a single process. No external
  infrastructure. No cloud dependency.
- **SARIF-native.** Findings use the SARIF 2.1.0 standard. Interoperable
  with VS Code, GitHub, and any SARIF-compatible tool.
- **Agent-friendly, not AI-first.** The CLI returns structured JSON on
  every command. Agents can delegate orchestration to Sverka instead of
  running tools one by one. But Sverka works perfectly well without any
  AI agent — it's a developer tool first.
- **Minimal.** No external runtime dependencies. The engine, normalizer,
  policy gate, and viewers are all standalone packages.

## How it fits

```
┌─────────────────────────────────────────────────┐
│                  sverka.config.ts                │
│         (your checks defined in code)            │
└──────────────────────┬──────────────────────────┘
                       │
          ┌────────────┴────────────┐
          ▼                         ▼
   ┌──────────────┐         ┌──────────────┐
   │  sverka run  │         │ sverka view  │
   │  (local)     │         │  (TUI/HTML)  │
   └──────┬───────┘         └──────────────┘
          │
          ▼
   ┌──────────────┐
   │  Findings    │
   │  (SARIF)     │
   └──────┬───────┘
          │
    ┌─────┴──────┐
    ▼            ▼
 ┌────────┐  ┌────────┐
 │  TUI   │  │  Web   │
 │ Viewer │  │  UI    │
 └────────┘  └────────┘
          │
          ▼
   ┌──────────────┐
   │ sverka       │
   │ compile      │
   │ --target     │
   │  github      │
   └──────────────┘
```

## What Sverka is not

- **Not a CI runner.** Sverka runs locally. It can compile to CI, but
  it does not host or execute CI pipelines in the cloud.
- **Not a Temporal replacement.** Sverka is a single-process runtime.
  There is no server, no worker fleet, no durable execution across
  machines.
- **Not AI-first.** Sverka works without any AI agent. Agent integration
  is a feature, not a requirement.
- **Not a YAML engine.** Workflows are TypeScript. YAML is an output
  format (via the compiler), not an input format.

## Next steps

- [Use cases](./use-cases.md) — concrete scenarios for local checks, CI, and agents.
- [SARIF pipeline](./findings/sarif-pipeline.md) — serialize, view, and dashboard.
- [First workflow](./getting-started/first-plan.md) — define, run, view, compile.
