# Built-in checks

Sverka's built-in check resolver maps 6 check IDs to commands based on the
detected package manager. Source: `packages/checks/src/resolver.ts`.

## Check IDs

| Check ID     | Description                          |
|--------------|--------------------------------------|
| `typecheck`  | TypeScript type checking             |
| `lint`       | Code linting                         |
| `test`       | Test suite                           |
| `clippy`     | Rust clippy lints                    |
| `vet`        | Go vet                               |
| `fmt-check`  | Rust formatting check                |

## Per-language resolution

The resolver uses the first matching entry (by check ID + package manager).
Node entries take precedence when multiple package managers are present.

### Node

| Check ID   | Package managers              | Command         |
|------------|-------------------------------|-----------------|
| `typecheck`| bun, npm, yarn, pnpm          | `<pm> run typecheck` |
| `lint`     | bun, npm, yarn, pnpm          | `<pm> run lint`      |
| `test`     | bun, npm, yarn, pnpm          | `<pm> run test`      |

### Python

| Check ID | Package managers                  | Command         |
|----------|-----------------------------------|-----------------|
| `lint`   | pip, poetry, uv, pipenv           | `ruff check`    |
| `test`   | pip, poetry, uv, pipenv           | `pytest`        |

### Rust

| Check ID     | Package manager | Command              |
|--------------|-----------------|----------------------|
| `clippy`     | cargo           | `cargo clippy`       |
| `fmt-check`  | cargo           | `cargo fmt --check`  |
| `test`       | cargo           | `cargo test`         |

### Go

| Check ID | Package manager | Command              |
|----------|-----------------|----------------------|
| `vet`    | go              | `go vet ./...`       |
| `test`   | go              | `go test ./...`      |

## Using the resolver

`createBuiltinResolver()` returns a `CheckResolver` that maps proposed
checks to executable operations.

```ts
import { createBuiltinResolver } from "@sverka/sdk";

const resolver = createBuiltinResolver();
```

The resolver is used internally by the planner. When a proposed check
matches a table entry, the resolver produces a `ResolvedCheck` with an
`OperationSpec` and output declarations for findings extraction.

## Extracting findings

`extractFindings()` reads check output files from an artifact directory and
normalizes SARIF into `readonly Finding[]`. It is async and takes three
positional arguments: the list of `CheckOutput` declarations, the artifact
directory path, and the check ID (used as a prefix for finding IDs).

```ts
import { extractFindings } from "@sverka/sdk";

const findings = await extractFindings(outputs, artifactDir, checkId);
```

Only SARIF 2.1.0 output is supported in v1. Non-SARIF formats (JSON, JUnit,
text) are skipped silently. Missing output files are also skipped. If a SARIF
file exists but cannot be parsed as JSON, `CheckError(EXTRACTION_FAILED)` is
thrown with the underlying `SyntaxError` as `cause`. If the JSON is valid but
the SARIF structure is invalid (e.g. missing location), `CheckError(EXTRACTION_FAILED)`
is thrown with the underlying `NormalizationError` (`INVALID_SARIF` or
`MISSING_LOCATION`) as `cause`.
