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

## Website

The site (`website/`) is a package tree of its own — it is not an npm
workspace member, so it installs and checks on its own:

```bash
bun --cwd=website install     # install the website's dependencies
bun --cwd=website run check   # typecheck the site (generates the route tree first)
bun --cwd=website test        # run the website's tests
bun --cwd=website run build   # build the site
```

`run check` generates `src/routeTree.gen.ts` (a build artifact the router
plugin writes) before running `tsc --noEmit`, so the typecheck works from
a clean checkout. The website consumes the published `@sverka/*` packages;
importing a sibling package's sources instead would typecheck node-side
code against the DOM lib.

`run build` also runs `docs:pipeline`, which executes the source CLI — the
root `bun install` from above (and built packages) is a prerequisite for a
full website build, though not for `run check` or `test`.

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
