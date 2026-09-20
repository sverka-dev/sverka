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

The CLI generates a `sverka.config.ts` that imports from `@sverka/workflow`,
so that package must be resolvable from your project. `sverka init` adds the
dependency automatically — a `file:`/`link:` spec when run from a local
checkout, or a semver range once the packages are published to npm.

To add it manually:

```sh
cd your-project
bun add @sverka/workflow        # after npm publish
bun add link:/path/to/sverka/packages/workflow   # local checkout
```

## Initialize

```sh
sverka init
```

This creates a `sverka.config.ts` file with a default Construct-based
verification workflow. Sverka auto-discovers your project type and suggests
relevant checks.

## Next steps

- [Define your first plan](./first-plan.md)
