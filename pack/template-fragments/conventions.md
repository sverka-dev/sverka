# Project Conventions Template

Copy this to the project root as `AGENTS.md` and fill in the project-specific
sections. The harness agents (architect, builder, reviewer) reference
`AGENTS.md` for project conventions.

## Project

<project name and one-line description>

## Tech stack

<language, runtime, package manager, monorepo tool, build, test, lint, format>

## Structure

```
<project directory layout>
```

## Conventions

- **SDD:** Specs are written first, in `specs/`, numbered and structured.
- **TDD:** Tests are written before implementation. Always.
- **Document-first:** Engineering docs in `engdocs/` before code.
- **Waves:** Work is organized in waves. Each wave: architect -> builder -> reviewer.
- **No `any`:** Use `unknown` and narrow. Strict TypeScript.
- **Public API:** Everything public is exported from `src/index.ts`.
- **Error handling:** Custom error classes per package.

## Commands

```bash
<install command>          # install dependencies
<build command>            # build all packages
<test command>             # run all tests
<lint command>             # lint all packages
<typecheck command>        # typecheck all packages
```

## Review

See `REVIEW.md` for the review policy.

## Security

See `SECURITY.md` for the security policy.
