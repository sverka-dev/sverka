# v1 Wave 3 — Storage Plan (sv-wthn.3.2)

**Spec:** `specs/31-storage/spec.md`
**ADR:** `engdocs/adr/ADR-014-storage-package.md`
**Depends on:** Spec 29 (`SnapshotStore` / `RunSnapshot` in `@sverka/runtime`)
**Package:** `@sverka/storage` (new)
**Base branch:** `v1-w3-storage` off the Wave 3 stack tip (after sv-wthn.3.1 impl lands the types in `@sverka/runtime`).

## Scope

Two `SnapshotStore` adapters: `FileSnapshotStore` (JSON per run, zero-dep)
and `SqliteSnapshotStore` (`node:sqlite`, built-in). One `StorageError`
class. No external deps. ~140 impl lines + ~280 test lines.

## Prerequisite (Step 0)

`@sverka/runtime` must export `SnapshotStore`, `RunSnapshot`, and
`createInMemorySnapshotStore` (Spec 29). If sv-wthn.3.1's implementation
has not landed yet, add the type definitions from Spec 29 to
`packages/runtime/src/engine-native/types.ts` and re-export them from
`packages/runtime/src/index.ts` as the first step. Do not duplicate the
types in `@sverka/storage` — import them type-only from `@sverka/runtime`.

## File layout

```
packages/storage/
  package.json
  project.json
  tsconfig.json
  tsdown.config.ts
  src/
    index.ts          # public re-exports
    file-store.ts     # FileSnapshotStore + createFileSnapshotStore
    sqlite-store.ts   # SqliteSnapshotStore + createSqliteSnapshotStore
    errors.ts         # StorageError + StorageErrorCode
    internal/
      serialize.ts    # serialize(snapshot) / deserialize(bytes) + validate
  src/__tests__/
    file-store.test.ts
    sqlite-store.test.ts
    serialize.test.ts
    public-api.test.ts
    helpers/fixtures.ts
```

## Scaffolding (mirror an existing leaf package, e.g. `@sverka/findings`)

- `package.json`: `"@sverka/storage"`, `type: "module"`, `main`/`module` →
  `./dist/index.mjs`, `types` → `./dist/index.d.mts`, `exports` map, `files:
  ["dist"]`. Scripts: `build: tsdown`, `test: vitest run --passWithNoTests`,
  `lint: eslint src`, `typecheck: tsc --noEmit`.
- `dependencies`: `"@sverka/runtime": "workspace:*"` (type-only usage, but
  workspace dep so the types resolve).
- `devDependencies`: `tsdown`, `typescript`, `vitest` (match repo versions).
- `project.json`: nx `build`/`test`/`lint`/`typecheck` targets; lint target
  uses `eslint src` (no `--ext`).
- `tsdown.config.ts`: entry `src/index.ts`, format `esm`, dts `true`,
  `outExtensions` → `.mjs` / `.d.mts` (match repo convention).
- `tsconfig.json`: extends root, `strict: true`, `noImplicitOverride: true`.

## TDD steps

1. **`serialize.ts`** — `serialize(snapshot): string` (pretty `JSON.stringify`)
   and `deserialize(text, runId): RunSnapshot` (`JSON.parse` + validate
   required fields + `status === "suspended"`; throw
   `StorageError(CORRUPT_SNAPSHOT)` on failure). Write `serialize.test.ts`
   first: round-trip a fixture snapshot; corrupt JSON throws; missing
   `suspendedStepId` throws; `status !== "suspended"` throws.
2. **`errors.ts`** — `StorageError` + `StorageErrorCode`. Test: `name`,
   `code`, `cause` propagation, `instanceof Error`.
3. **`file-store.ts`** — `createFileSnapshotStore(config?)`. `save`:
   `mkdir -p <root>/.sverka/runs/<runId>` then write
   `serialize(snapshot)` to `snapshot.json`. `load`: read file
   (`ENOENT` → `undefined`), `deserialize`. `delete`: `unlink`,
   swallow `ENOENT`. Wrap fs errors in `StorageError(STORE_IO_FAILED)`.
   Write `file-store.test.ts` covering test-plan items 1–6.
4. **`sqlite-store.ts`** — `createSqliteSnapshotStore(config?)`. Constructor:
   `mkdir -p` parent of `path` (skip for `:memory:`), open `DatabaseSync`,
   `exec` the `CREATE TABLE`. `save`/`load`/`delete` via prepared
   statements. Return `SnapshotStore & { close(): void }`. `close()` calls
   `db.close()`; ops after close throw `StorageError(STORE_IO_FAILED)`.
   Write `sqlite-store.test.ts` covering items 7–13. Use `:memory:` for
   most tests; one test uses a temp file dir for cross-instance persistence
   (item 12).
5. **`index.ts`** — re-export the two factories, two config types,
   `StorageError`, `StorageErrorCode`.
6. **`public-api.test.ts`** — assert the exact export set (items 14, 16, 17);
   type-assign both stores to `SnapshotStore`.
7. **Gates** — `bun run test` (storage), `typecheck`, `lint`, `build` for
   `@sverka/storage`; then full monorepo `bun run test` to confirm no
   regressions. Expect typecheck to pass (storage depends only on runtime
   types).

## Critical reminders

- `node:sqlite` `DatabaseSync` is synchronous; wrap calls so `save`/`load`/
  `delete` still return `Promise` (the interface is async). Use
  `Promise.resolve()` around the sync work, or `async` fns — either is fine,
  the work itself is sync.
- `node:sqlite` returns rows as `[Object: null prototype]`. Access
  `row.snapshot_json`.
- `InputValue` includes `readonly string[]`; `JSON.parse` yields a mutable
  array — acceptable for storage round-trip (the readonly constraint is a
  type-level guarantee, not runtime).
- No `any`. `unknown` + narrowing for parsed JSON.
- `StorageError` MUST use `override readonly cause`.
- Commit hygiene: stage only `packages/storage/**` +
  `specs/31-storage/spec.md` + `engdocs/architecture/v1-wave-3-storage-plan.md`
  + `engdocs/adr/ADR-014-storage-package.md` + `bun.lock` (if a dep was
  added — none should be). Exclude `city.toml`/`agents/`/`.devin/`/`.gc/`/
  `.beads/`/`formulas/`.
