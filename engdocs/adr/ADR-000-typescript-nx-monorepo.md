# ADR-000: Use TypeScript native monorepo with Nx

## Context

Sverka needs a monorepo structure to manage 15+ packages with shared
dependencies, consistent build tooling, and cross-package type checking.

## Decision

Use Nx as the monorepo orchestrator with TypeScript native packages.

## Consequences

- All packages share a single `tsconfig.base.json` for consistent compiler
  options.
- Nx handles task orchestration (build, test, lint) across packages.
- Package graph is explicit and cacheable.
- Nx plugins can be added later for framework-specific optimizations.

## Alternatives

- **Turborepo:** Simpler but less powerful task graph. Rejected because Nx
  has better TypeScript support and caching.
- **Plain bun workspaces:** No task orchestration. Rejected because we need
  cross-package build ordering.
- **Lerna:** Deprecated in favor of Nx. Rejected.
