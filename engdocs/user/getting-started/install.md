# Install

## Prerequisites

- **Node.js** >= 24
- **Bun** >= 1.1
- **Docker** (optional, for container-based checks)

## Install the CLI

```sh
bun add -g @sverka/cli
```

This installs the `sverka` command globally.

## Add the SDK to your project

The CLI generates a `sverka.config.ts` that imports from `@sverka/sdk`. The
SDK must be installed in your project so the config can resolve its imports.

```sh
cd your-project
bun add @sverka/sdk
```

## Initialize

```sh
sverka init
```

This creates a `sverka.config.ts` file with a default verification workflow.
Sverka auto-discovers your project type and suggests relevant checks.

## Next steps

- [Define your first plan](./first-plan.md)
