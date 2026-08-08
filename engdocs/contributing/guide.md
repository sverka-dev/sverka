# Contributor Guide

## Getting started

1. Clone the repository.
2. Install dependencies: `bun install`
3. Build all packages: `bun run build`
4. Run tests: `bun test`
5. Run linter: `bun run lint`
6. Run typecheck: `bun run typecheck`

## Workflow

Sverka is built in waves. Each wave goes through:

1. **Architect** designs the spec and implementation plan.
2. **Builder** implements from the spec using TDD (tests first).
3. **Reviewer** gates quality (tests, build, lint, typecheck, spec compliance).

## Conventions

- **SDD:** Specs are written first in `specs/`.
- **TDD:** Tests are written before implementation.
- **Document-first:** Engineering docs in `engdocs/` before code.
- **No `any`:** Use `unknown` and narrow. Strict TypeScript.
- **Public API:** Everything public is exported from `src/index.ts`.
- **Error handling:** Custom error classes per package.
- **ESM only:** All packages use ES modules.

## Commit style

- Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`
- Scope: `feat(core): add pipeline builder`
- Breaking changes: `feat(core)!:` with BREAKING CHANGE footer.

## Branch naming

- `wave-NN-<short-description>` for wave work
- `fix-<issue-number>-<short-description>` for fixes
