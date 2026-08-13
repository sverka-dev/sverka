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

The CLI generates a `sverka.config.ts` that imports from `@sverka/cdk`.
`@sverka/cdk` is required in your project so the config can resolve its
imports. Add `@sverka/sdk` and/or `@sverka/decorators` for the authoring
surfaces you use.

```sh
cd your-project
bun add @sverka/cdk
```

Install `@sverka/sdk` and/or `@sverka/decorators` only when you want those
API surfaces. Install all three if you want to try each surface.

## Initialize

```sh
sverka init
```

This creates a `sverka.config.ts` file with a default Construct-based
verification workflow. Sverka auto-discovers your project type and suggests
relevant checks.

## Next steps

- [Define your first plan](./first-plan.md)
