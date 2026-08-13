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

The CLI generates a `sverka.config.ts` that imports from `@sverka/constructs`.
The constructs package must be installed in your project so the config can
resolve its imports.

```sh
cd your-project
bun add @sverka/constructs @sverka/sdk @sverka/decorators
```

You only need one of the three authoring packages. Install all three if you
want to try each surface.

## Initialize

```sh
sverka init
```

This creates a `sverka.config.ts` file with a default Construct-based
verification workflow. Sverka auto-discovers your project type and suggests
relevant checks.

## Next steps

- [Define your first plan](./first-plan.md)
