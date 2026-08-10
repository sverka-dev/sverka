# Troubleshooting

## `sverka execute` exits with code 1

Exit code 1 means policy failure — findings exceeded the configured thresholds. Check the findings output:

```bash
sverka execute --format json | jq '.findings[] | {rule, severity, file}'
```

To suppress known findings, create a baseline:

```bash
sverka baseline create
sverka execute  # now only new findings are shown
```

## `sverka execute` exits with code 3

Exit code 3 means runtime error. Common causes:

- **Docker not available:** `sverka execute --executor docker` requires Docker on PATH. Check with `sverka doctor`.
- **Config not found:** sverka can't find `sverka.config.ts`. Run `sverka init` or specify `--config path/to/config`.

## `bun test` fails but `bun run test` passes

`bun test` runs Bun's built-in test runner, not vitest. Always use `bun run test` (which runs `vitest run` via nx).

## `sverka plan` shows no operations

The config file may be empty or the workflow has no tasks. Check:

```bash
sverka validate --verbose
sverka inspect
```

## Docker executor hangs

The Docker executor uses `spawnSync` with a 5-second timeout for availability checks. If Docker is slow to respond:

```bash
# Check Docker is running
docker info

# Use host executor instead
sverka execute --executor host
```

## Config validation fails

Common config errors:

- Missing `name` field in `defineWorkflow`
- `workflow` must be a `pipeline()` or single `task()`
- `task()` requires a `run` with `command` and `args`
- Circular dependencies in `dependsOn`

Run `sverka validate --verbose` for detailed error messages.
