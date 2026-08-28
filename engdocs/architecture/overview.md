# Architecture Overview

Sverka is a composable workflow SDK, local CI runtime, and multi-target
compiler for software verification.

## System flow

```text
Workflow SDK (TypeScript code)
  → Discovery + Planner (project context detection)
  → Canonical Plan IR (stable, serializable DAG)
  → Local Executors (Docker, Podman, Host, Remote API)
  → Target Compilers (GitHub Actions, GitLab CI, Earthly)
  → Findings + Verdict (normalized output)
```

## Key principles

1. **Canonical source is the workflow code + Plan IR.** CI providers are
   compilation targets, not the source of truth.
2. **Local executor is first-class.** Not a CI emulator — a real runtime.
3. **Operations are lazy and composable.** Planning records intent without
   side effects.
4. **Findings are normalized.** Every tool's output maps to one Finding model.
5. **Zero-config by default, full CDK-style customization when needed.**

## Package dependency graph

```
sdk → core → ir
              ↓
         runtime → runtime-docker
                 → runtime-host
         planner → core, ir
         findings → ir
         policy → findings
         checks → core, ir
         compiler-github → ir
         compiler-gitlab → ir
         cli → sdk, planner, runtime, findings, policy, compilers
```

## Execution modes

- **Plan mode:** records operations and dependencies, no side effects
- **Execution mode:** executes resolved operations via executors
- **Compile mode:** emits target-specific artifact (GitHub Actions YAML, etc.)
