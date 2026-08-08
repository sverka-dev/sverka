# Development Setup

## Prerequisites

- **Bun** >= 1.1 (package manager and runtime)
- **Node.js** >= 24 (for tooling compatibility)
- **Docker** (optional, for Docker executor tests)
- **Git**

## Setup

```bash
git clone https://github.com/sverka-dev/sverka.git
cd sverka
bun install
bun run build
bun test
```

## Useful commands

```bash
bun run build          # build all packages (tsdown via nx)
bun test               # run all tests (vitest)
bun run lint           # lint all packages (eslint)
bun run typecheck      # typecheck all packages
bun run build --filter=@sverka/core   # build a single package
bun test --filter=@sverka/core        # test a single package
```

## IDE setup

- VS Code / Cursor recommended
- ESLint extension enabled
- Prettier extension enabled
- TypeScript strict mode

## Gas City (optional)

The project includes Gas City orchestration config. If you have Gas City
installed:

```bash
gc start               # start the city (mayor agent wakes up)
gc status              # check city status
gc bd list             # list work beads
```
