# ADR-002: Use tsdown for builds

## Context

Sverka packages need to be built from TypeScript source to distributable
ESM/CJS bundles with type declarations.

## Decision

Use tsdown as the build tool for all packages.

## Consequences

- tsdown is built on rolldown, providing fast bundling.
- Supports both ESM and CJS output.
- Generates `.d.ts` type declarations.
- Configurable per-package via `tsdown.config.ts`.
- Integrates with Nx as a task target.

## Alternatives

- **tsc directly:** No bundling, slower, no tree-shaking. Rejected.
- **unbuild:** Good but slower. Rejected in favor of tsdown's rolldown backend.
- **tsup:** Mature but esbuild-based. Rejected in favor of tsdown's rolldown.
