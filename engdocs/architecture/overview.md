# Architecture Overview

Sverka is a portable workflow runtime — code-defined workflows with CI
semantics, local execution, and optional multi-target compilation.

## System flow

```text
Workflow definition (TypeScript code)
  → Discovery + Planner (project context detection)
  → Canonical Plan IR (stable, serializable DAG)
  → Run Plan binding
  → Local execution (Host, Container, or remote API)
  → Optional: compile to GitHub Actions, GitLab CI, or Earthly
  → Optional: findings + verdict (verification profile)
```

## Key principles

1. **Canonical source is the workflow code + Plan IR.** CI providers are
   compilation targets, not the source of truth.
2. **Local execution is the primary mode.** CI compilation is optional.
3. **Operations are lazy and composable.** Planning records intent without
   side effects.
4. **Verification is an optional profile.** Checks, findings, and policy
   layer on top of the workflow runtime.
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
