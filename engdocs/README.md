# Sverka — Engineering Documentation

## Document-first

Engineering docs are written before code. Every package, every architectural
decision, every non-trivial design choice is documented here first.

## Structure

```
engdocs/
  README.md           # this file
  architecture/       # architecture overview and component docs
  adr/                # architecture decision records (numbered)
  contributing/       # contributor guide and conventions
```

## Architecture docs

- [Architecture Overview](./architecture/overview.md) — high-level system design
- [Package Dependencies](./architecture/dependencies.md) — how packages depend on each other

## ADRs

ADRs are numbered: `ADR-NN-title.md`. Each ADR has: Context, Decision,
Consequences, Alternatives.

- [ADR-000: Use TypeScript native monorepo with Nx](./adr/ADR-000-typescript-nx-monorepo.md)
- [ADR-001: Use Bun as package manager](./adr/ADR-001-bun-package-manager.md)
- [ADR-002: Use tsdown for builds](./adr/ADR-002-tsdown-build.md)
- [ADR-003: Canonical Plan IR as source of truth](./adr/ADR-003-canonical-plan-ir.md)
- [ADR-004: Thin wrapper CI compiler first](./adr/ADR-004-thin-wrapper-ci-compiler.md)
- [ADR-005: Predecessor-reference resolution model](./adr/ADR-005-predecessor-reference-resolution.md)
- [ADR-006: SHA-256 content-addressed Plan and Operation IDs](./adr/ADR-006-sha256-content-addressed-plan-ids.md)

## Contributing

- [Contributor Guide](./contributing/guide.md) — how to contribute
- [Development Setup](./contributing/development-setup.md) — local dev environment
- [Wave Process](./contributing/waves.md) — how waves work
