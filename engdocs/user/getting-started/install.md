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

The CLI generates a `sverka.config.ts` that imports from `@sverka/workflow`.
`@sverka/workflow` is required in your project so the config can resolve its
imports. Add `@sverka/sdk` for the programmatic API (`createSverka`, `$`,
`shell`).

```sh
cd your-project
bun add @sverka/workflow
```

Install `@sverka/sdk` only when you want the programmatic surface.

## Initialize

```sh
sverka init
```

This creates a `sverka.config.ts` file with a default Construct-based
verification workflow. Sverka auto-discovers your project type and suggests
relevant checks.

## Next steps

- [Define your first plan](./first-plan.md)
