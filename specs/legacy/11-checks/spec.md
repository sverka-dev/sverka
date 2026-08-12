# Spec 11 — Checks Package: Check Resolution and Findings Extraction

## Overview

The `checks` package bridges the planner's `ProposedCheck[]` and the IR
`OperationSpec`. The planner proposes *what* category of check to run
(`lint`, `typecheck`, `test`); the checks package resolves *how* to run it
(command, args, outputs) given the project's package managers and languages.
It also extracts findings from SARIF artifacts after execution.

The package does **not** re-detect or re-propose checks — that is the
planner's job (`@sverka/planner`). It does **not** re-normalize findings —
that is the findings package's job (`@sverka/findings`). It maps checkIds to
executable operations and reads normalized findings from artifact files.

## Goals

1. Resolve a `ProposedCheck` into a `ResolvedCheck` containing an
   `OperationSpec` ready for the IR conversion and a list of output
   declarations for findings extraction.
2. Ship a built-in resolver covering the checkIds the planner already
   proposes: `typecheck`, `lint`, `test`, `clippy`, `vet`, `fmt-check`.
3. Extract findings from SARIF artifact files via `@sverka/findings`.
4. Allow custom resolvers via a `CheckResolver` interface (no YAML, no
   plugin descriptor format — implement the interface in TypeScript).
5. Export all public types and functions from `src/index.ts`.

## Non-goals (v1 / Wave 11)

- **Re-detecting or re-proposing checks.** The planner owns discovery and
  proposal. The checks package only resolves.
- **Re-normalizing findings.** The findings package owns SARIF
  normalization. The checks package calls `normalizeSarif`.
- **YAML plugin descriptors.** No third-party providers exist. Custom
  resolvers implement the `CheckResolver` interface in TypeScript.
- **Tool-specific providers** (eslint, trivy, gitleaks, semgrep). The
  planner proposes generic checkIds; the resolver maps them to commands per
  package manager. Tool-specific providers are future work.
- **Non-SARIF extraction** (raw ESLint JSON, JUnit, text). The findings
  package defers non-SARIF normalizers; the checks package follows.
- **Executing checks.** Execution is the runtime's job.
- **Managing tool installation or image pinning.** The resolver declares
  commands; the runtime executes them.

## Interfaces

```typescript
// src/index.ts — public exports

export type { CheckResolver, ResolvedCheck, CheckOutput } from "./resolver.js";
export { createBuiltinResolver } from "./resolver.js";
export { extractFindings } from "./extract.js";
export { CheckError, type CheckErrorCode } from "./errors.js";
```

```typescript
// src/resolver.ts

import type { OperationSpec } from "@sverka/core";
import type { ProposedCheck, ProjectContext } from "@sverka/planner";

/**
 * Resolves a ProposedCheck into an executable OperationSpec with output
 * declarations. Returns null when the resolver has no mapping for the
 * given check + context (the caller skips the check).
 */
export interface CheckResolver {
  resolve(check: ProposedCheck, ctx: ProjectContext): ResolvedCheck | null;
}

/**
 * A fully-resolved check: an OperationSpec for the IR plus output
 * declarations for findings extraction.
 */
export interface ResolvedCheck {
  readonly checkId: string;
  readonly operation: OperationSpec;
  readonly outputs: readonly CheckOutput[];
}

/**
 * An output file a check produces, used for findings extraction.
 */
export interface CheckOutput {
  /** Relative path within the artifact directory. */
  readonly path: string;
  readonly format: "sarif" | "json" | "junit" | "text";
}

/**
 * Built-in resolver backed by a (checkId, packageManager) → command table.
 * Covers the 6 checkIds the planner proposes across Node/Python/Rust/Go.
 */
export function createBuiltinResolver(): CheckResolver;
```

```typescript
// src/extract.ts

import type { Finding } from "@sverka/findings";

/**
 * Extract findings from a check's output files. Reads each declared output
 * from `artifactDir`, parses SARIF via `@sverka/findings.normalizeSarif`,
 * and returns the combined findings.
 *
 * - Missing output file: skipped (no findings from that output).
 * - Non-SARIF format: skipped (deferred per findings non-goal).
 * - Invalid SARIF: throws CheckError(EXTRACTION_FAILED).
 *
 * @throws {CheckError} EXTRACTION_FAILED — SARIF file exists but is invalid.
 */
export function extractFindings(
  outputs: readonly CheckOutput[],
  artifactDir: string,
  checkId: string,
): Promise<readonly Finding[]>;
```

```typescript
// src/errors.ts

export class CheckError extends Error {
  readonly code: CheckErrorCode;
  override readonly cause: unknown;
  constructor(message: string, code: CheckErrorCode, cause?: unknown) {
    super(message);
    this.name = "CheckError";
    this.code = code;
    this.cause = cause;
  }
}

export type CheckErrorCode = "RESOLUTION_FAILED" | "EXTRACTION_FAILED";
```

## Data models

### Built-in resolution table

The built-in resolver maps `(checkId, packageManagerCategory)` to a command.
When the project has multiple package managers, the first matching entry wins
(in table order). When no entry matches, `resolve()` returns null.

| checkId     | packageManager         | command   | args                         | outputs |
|-------------|------------------------|-----------|------------------------------|---------|
| `typecheck` | bun                    | `bun`     | `["run", "typecheck"]`       | `[]`    |
| `typecheck` | npm/yarn/pnpm          | `npm`/`yarn`/`pnpm` | `["run", "typecheck"]` | `[]`    |
| `lint`      | bun                    | `bun`     | `["run", "lint"]`            | `[]`    |
| `lint`      | npm/yarn/pnpm          | `npm`/`yarn`/`pnpm` | `["run", "lint"]`      | `[]`    |
| `lint`      | pip/poetry/uv/pipenv   | `ruff`    | `["check"]`                  | `[]`    |
| `test`      | bun                    | `bun`     | `["run", "test"]`            | `[]`    |
| `test`      | npm/yarn/pnpm          | `npm`/`yarn`/`pnpm` | `["run", "test"]`      | `[]`    |
| `test`      | pip/poetry/uv/pipenv   | `pytest`  | `[]`                         | `[]`    |
| `test`      | cargo                  | `cargo`   | `["test"]`                   | `[]`    |
| `test`      | go                     | `go`      | `["test", "./..."]`          | `[]`    |
| `clippy`    | cargo                  | `cargo`   | `["clippy"]`                 | `[]`    |
| `fmt-check` | cargo                  | `cargo`   | `["fmt", "--check"]`         | `[]`    |
| `vet`       | go                     | `go`      | `["vet", "./..."]`           | `[]`    |

Built-in checks declare `outputs: []` — the project's scripts may or may not
emit SARIF. Findings extraction is exercised by custom resolvers that declare
SARIF outputs, and by the test suite with synthetic fixtures.

### ResolvedCheck.operation fields

The resolver constructs the `OperationSpec` from the `ProposedCheck`:

| field        | source                              |
|--------------|-------------------------------------|
| `id`         | `check.id` (the ProposedCheck id)   |
| `kind`       | `"check"`                           |
| `name`       | `check.checkId`                     |
| `command`    | from table                          |
| `args`       | from table                          |
| `description`| `check.reason`                      |

No `image`, `dependsOn`, `env`, or `workingDir` is set by the built-in
resolver (host execution, no dependencies, default working dir).

### Findings extraction

1. For each `CheckOutput` in `outputs`:
   - Skip if `format !== "sarif"` (non-SARIF deferred).
   - Read `${artifactDir}/${output.path}`. Skip if the file does not exist.
   - `JSON.parse` the file content.
   - Call `normalizeSarif(sarif, { root: artifactDir, checkIdPrefix: checkId, defaultConfidence: 0.5 })`.
   - Collect the returned `Finding[]`.
2. If `normalizeSarif` throws `NormalizationError`, rethrow as
   `CheckError(EXTRACTION_FAILED, cause)`.
3. Return the combined findings from all outputs.

## Error handling

- **`RESOLUTION_FAILED`** — a custom resolver's `resolve()` threw. The
  caller (SDK) catches and skips the check with a warning. The built-in
  resolver never throws; it returns null for unknown mappings.
- **`EXTRACTION_FAILED`** — a SARIF output file exists but is invalid
  (`normalizeSarif` threw `NormalizationError`). Missing files are not
  errors (skipped silently).
- All errors include `cause: unknown` with `override` per
  `noImplicitOverride`.
- No `any` types.

## Test plan

Tests live in `packages/checks/src/__tests__/` and run via `bun run test`
(vitest via nx).

1. **Built-in resolver — Node (bun):** `typecheck`/`lint`/`test` resolve to
   `bun run <checkId>` with correct command, args, `kind: "check"`,
   `id = check.id`, `name = check.checkId`, `description = check.reason`.
2. **Built-in resolver — Node (npm/yarn/pnpm):** same checkIds resolve to
   the correct package manager command.
3. **Built-in resolver — Python:** `lint` → `ruff check`, `test` → `pytest`.
4. **Built-in resolver — Rust:** `clippy`/`fmt-check`/`test` resolve to
   `cargo` commands.
5. **Built-in resolver — Go:** `vet`/`test` resolve to `go` commands.
6. **Built-in resolver — unknown:** unknown checkId → null. Known checkId
   with unmatched packageManager (e.g. `clippy` + bun) → null.
7. **Built-in resolver — multiple package managers:** first matching entry
   in table order wins.
8. **Built-in resolver — outputs:** all built-in checks have `outputs: []`.
9. **Custom resolver:** a user-implemented `CheckResolver` returns a
   `ResolvedCheck` with a SARIF output declaration.
10. **extractFindings — SARIF:** a synthetic SARIF file in a temp
    `artifactDir` produces `Finding[]` with correct `checkId` prefix.
11. **extractFindings — missing file:** declared output path does not exist
    → `[]` (no throw).
12. **extractFindings — non-SARIF format:** `format: "json"` → `[]` (skipped).
13. **extractFindings — invalid SARIF:** file exists but is not valid SARIF
    → throws `CheckError(EXTRACTION_FAILED)` with `cause` set to the
    `NormalizationError`.
14. **extractFindings — empty outputs:** `[]` → `[]`.
15. **CheckError:** `cause` uses `override`; `code` is the union; `name`
    is `"CheckError"`.
16. **Public API:** all exports present in `src/index.ts`; no extra exports.
17. **Determinism:** same `(check, ctx)` produces byte-identical
    `ResolvedCheck`.
