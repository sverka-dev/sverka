# Install

## Prerequisites

- **Node.js** >= 24
- **Bun** >= 1.1
- **Docker** (optional, for container-based checks)

## Install the CLI

```sh
bun add -g sverka
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

## Scaffold a new project (`create-sverka`)

The `create-sverka` package is the create-* convention entry point — it
forwards to `sverka init` with argument translation, so no global install
is needed:

```sh
bun create sverka          # = sverka init (current directory)
bun create sverka my-app   # = sverka init --root my-app (creates the dir)
npm create sverka my-app   # same via npm
```

A leading positional argument is the target directory; every other flag
forwards verbatim to `sverka init` (`--template full`, `--detect`,
`--force`, …).

## Next steps

- [Define your first plan](./first-plan.md)
