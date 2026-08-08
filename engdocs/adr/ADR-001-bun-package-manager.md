# ADR-001: Use Bun as package manager

## Context

Sverka needs a fast, reliable package manager for a large monorepo with
many workspace packages.

## Decision

Use Bun as the package manager and runtime.

## Consequences

- `bun install` is significantly faster than npm/pnpm/yarn.
- Bun supports workspaces natively via `bunfig.toml`.
- Bun can run TypeScript directly without a separate transpilation step.
- Bun's test runner (`bun test`) can be used as a fast alternative, though
  we standardize on Vitest for richer test features.
- All documentation and agent prompts reference `bun` commands.

## Alternatives

- **pnpm:** Fast and reliable with excellent workspace support. Rejected in
  favor of Bun's speed and integrated runtime.
- **npm:** Too slow for a monorepo of this size. Rejected.
- **yarn:** Berry has good workspace support but slower than Bun. Rejected.
