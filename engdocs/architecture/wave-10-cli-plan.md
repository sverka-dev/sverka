# Wave 10 — CLI Implementation Plan

**Architect:** architect-1
**Spec:** `specs/10-cli/spec.md`
**Package:** `@sverka/cli` → `packages/cli`
**Depends on:** `@sverka/sdk`, `yargs`

This plan is the contract the builder implements against. The spec is the
source of truth; this plan adds sequencing, file layout, conventions, and
edge-case guidance. Where the two disagree, the spec wins.

## 1. Spec amendments applied (architect)

The original spec (439 lines) was trimmed to ~250 lines. Major cuts:

1. **6 commands cut** (reference non-existent features):
   - `compile` — compilers are waves 12-13.
   - `replay` — no saved-plan loading in SDK.
   - `diff` — no plan/finding diff in SDK.
   - `findings` — no stored run findings system.
   - `plugin` — no plugin system.
   - `watch` — file watching is future work.
2. **SARIF output format cut.** No SARIF formatter exists.
3. **`--remote` flag cut.** Remote discovery cut in Wave 6.
4. **`--runtime podman`/`auto` cut.** runtime-podman is a scaffold. No
   auto-selection logic. Renamed to `--executor` (matches SDK's
   `SverkaOptions.executor`).
5. **`--format sarif` cut.** Only `human` and `json`.
6. **`Command`/`CommandArg`/`CommandFlag`/`CommandContext` interfaces
   removed.** yargs handles arg parsing — no need to re-invent a command
   framework. Each command is a function that receives parsed yargs args
   + global flags + output writer.
7. **`CliError.code` typed as `CliErrorCode` union**, not `string`.
8. **`ExitCode` as const object** (not enum — no enums in the codebase).
9. **`override` on `cause` property.** Per noImplicitOverride.
10. **`COMPILE_TARGET_REQUIRED` error code removed.** No compile command.
11. **`SDK_ERROR` error code added.** Wraps SDK errors with cause.
12. **`doctor --fix` cut.** Just reports in v1.
13. **`init --template auto` cut.** Only `minimal` and `full` templates.
14. **Test command corrected:** `bun test` → `bun run test`.
15. **`yargs` chosen over `citty`.** yargs is already in the dependency
    tree (transitive). citty is not available.
16. **Colors cut.** Plain text output in v1. No chalk/colorette dependency.

## 2. Scope

Implement the `sverka` CLI with 7 commands:

- `init` — create `sverka.config.ts` from template.
- `inspect` — discover and print `ProjectContext`.
- `plan` — run SDK `plan()` and print `PlanResult`.
- `execute`/`run` — run SDK `execute()` and print `ExecutionResult`.
- `validate` — load and validate config without executing.
- `baseline` — `create`/`update`/`show`/`clear` subcommands.
- `doctor` — check Node/Bun/git availability.
- `main(argv)` — entry point, arg parsing, dispatch, exit codes.
- `CliError` + `CliErrorCode` + `ExitCode`.
- Global flags: `--format`, `--config`, `--root`, `--quiet`, `--verbose`.
- Human and JSON output formats.
- `OutputWriter` abstraction for testability.

**Depends on:** `@sverka/sdk` (all business logic), `yargs` (arg parsing).

**Out of scope (do NOT implement in this wave):**
- `compile`, `replay`, `diff`, `findings`, `plugin`, `watch` commands.
- SARIF output format.
- `--remote` flag.
- `--runtime podman`/`auto`.
- Colors/TTY detection.
- Shell completion.
- Auto-update.
- `doctor --fix`.
- `init --template auto`.

## 3. Scaffolding status (already present; builder fixes three items)

- `packages/cli/package.json` — **fix 1:** dist paths are `.js`/`.d.ts`;
  must be `.mjs`/`.d.mts`. **fix 2:** add `@sverka/sdk` to `dependencies`
  (`"workspace:*"`). **fix 3:** add `yargs` to `dependencies`. Run
  `bun install` after.
- `packages/cli/project.json` — **fix:** lint target uses
  `eslint src --ext .ts`; remove `--ext .ts` (ESLint 9 flat config).
- `tsconfig.json`, `tsdown.config.ts` — already match siblings; no changes.
- `src/index.ts` — placeholder; builder fills exports.

## 4. File layout

```text
packages/cli/src/
  index.ts              # main() entry point, exports
  types.ts              # GlobalFlags, OutputWriter, ExitCode, CliError, CliErrorCode
  output.ts             # OutputWriter impl (stdout/stderr), formatters (human, json)
  commands/
    init.ts             # init command
    inspect.ts          # inspect command
    plan.ts             # plan command
    execute.ts          # execute/run command
    validate.ts         # validate command
    baseline.ts         # baseline create/update/show/clear
    doctor.ts           # doctor command
  __tests__/
    main.test.ts        # entry point, global flags, exit codes
    init.test.ts        # test plan 2
    inspect.test.ts     # test plan 3
    plan.test.ts        # test plan 4
    execute.test.ts     # test plan 5
    validate.test.ts    # test plan 6
    baseline.test.ts    # test plan 7
    doctor.test.ts      # test plan 8
    output.test.ts      # output formats
    public-api.test.ts  # exports match spec
    helpers/
      fixtures.ts       # temp dirs, sample configs, mock output writer
```

## 5. Conventions

- **No `any`.** `cause` is `unknown`. yargs parsed args are typed via
  interfaces per command. Strict TS.
- **OutputWriter abstraction.** All output goes through an `OutputWriter`
  instance. In production, writes to stdout/stderr. In tests, captures
  output for assertion. This is the testability seam — no mocking of
  `process.stdout` needed.
- **Exit codes.** `main()` returns the exit code. The caller (bin script)
  calls `process.exit(code)`. `main()` itself does NOT call
  `process.exit` — this makes it testable.
- **Error handling.** `CliError` is thrown for CLI errors. SDK errors
  (`SdkError`) are caught and wrapped in `CliError` with code `SDK_ERROR`
  and the original error in `cause`. Policy failures (verdict `fail`) are
  NOT errors — they produce exit code 1.
- **`override` on `cause`.** `CliError.cause` MUST have `override` modifier
  (noImplicitOverride).
- **yargs usage.** Use yargs for arg parsing. Each command registers its
  flags and handler. Global flags are parsed first, then command-specific
  flags. The handler receives `(args, global, output)`.
- **JSON output.** `--format json` emits a single JSON object on stdout
  via `output.writeLine(JSON.stringify(...))`. The structure is
  `{ command, verdict?, data, durationMs }`.
- **Human output.** Plain text. No colors. Tables are simple aligned
  text. Keep formatting minimal — the CLI is functional, not pretty.

## 6. Implementation steps (builder, TDD — tests first)

1. **Fix scaffolding.** Edit `package.json`: dist paths → `.mjs`/`.d.mts`,
   add `@sverka/sdk: workspace:*` and `yargs` to `dependencies`.
   Edit `project.json` lint → `eslint src`. `bun install`.
2. **`types.ts` + `output.ts` + tests.**
   - `GlobalFlags`, `OutputWriter`, `ExitCode` (const object), `CliError`,
     `CliErrorCode`.
   - `ConsoleOutputWriter`: writes to stdout/stderr.
   - `createOutputWriter(global)`: returns ConsoleOutputWriter, respects
     `--quiet` (suppresses stdout) and `--verbose` (adds stderr debug).
   - **`override` on `cause`** in CliError.
   - Test: CliError construction, ExitCode values, OutputWriter capture.
3. **`main()` + global flag parsing + tests (TDD).**
   - `main(argv)`: parse global flags with yargs, dispatch to command
     handler, catch errors, return exit code.
   - Unknown command → `CliError(UNKNOWN_COMMAND)` → exit 2.
   - SDK errors → `CliError(SDK_ERROR, ..., cause)` → exit 3.
   - Test: global flags parsed correctly, unknown command exit 2, exit
     codes (test plan 1, 9, 10).
4. **`init` command + tests (TDD).**
   - `--template` (minimal/full, default minimal), `--force`.
   - Write template file to `root/sverka.config.ts`.
   - If file exists and no `--force` → `CliError(CONFIG_EXISTS)` → exit 2.
   - Test: creates config, fails on existing, --force overwrites (test
     plan 2).
5. **`inspect` command + tests (TDD).**
   - `createPlanner().discover({ root })` → `ProjectContext`.
   - Human: print context fields (languages, package managers, etc.).
   - JSON: `JSON.stringify({ command: "inspect", data: context, ... })`.
   - Test: prints context, JSON format (test plan 3).
6. **`plan` command + tests (TDD).**
   - `createSverka({ root, configPath }).plan()` → `PlanResult`.
   - Human: print context + proposal/operations summary.
   - JSON: `JSON.stringify({ command: "plan", data: result, ... })`.
   - Test: prints plan, no execution (test plan 4).
7. **`execute`/`run` command + tests (TDD).**
   - `createSverka({ root, configPath, executor, baselinePath, onlyNew
     }).execute()` → `ExecutionResult`.
   - Exit code: 0 if verdict "pass", 1 if "fail".
   - `--executor host`/`docker` (default host).
   - Human: print findings (empty in v1), verdict, status.
   - JSON: `JSON.stringify({ command: "execute", verdict, data: result,
     ... })`.
   - Test: exit codes, executor selection, JSON output (test plan 5).
8. **`validate` command + tests (TDD).**
   - `loadWorkflow(configPath)` — if success, print "valid". If
     `SdkError(CONFIG_INVALID)`, print errors, exit 2. If
     `SdkError(CONFIG_LOAD_FAILED)`, print error, exit 3. If
     `SdkError(CONFIG_NOT_FOUND)`, print error, exit 2.
   - Test: valid config, invalid config, missing config (test plan 6).
9. **`baseline` command + tests (TDD).**
   - `create`: run `execute()`, `saveBaseline(createBaseline(findings),
     path)`.
   - `update`: run `execute()`, `loadBaseline(path)`,
     `saveBaseline(updateBaseline(newFindings, existing), path)`.
   - `show`: `loadBaseline(path)`, print contents.
   - `clear`: `fs.unlink(path)`.
   - Default path: `.sverka/baseline.json`. Override with `--baseline`.
   - Test: all 4 subcommands (test plan 7).
10. **`doctor` command + tests (TDD).**
    - Check: `node --version`, `bun --version`, `git --version`.
    - Use `child_process.execSync` to run each, parse version.
    - Print status table. Exit 0 if all pass, 3 if any missing.
    - Test: all pass, git missing (test plan 8).
11. **`public-api.test.ts`.** Assert `src/index.ts` exports `main`,
    `GlobalFlags`, `OutputWriter`, `ExitCode`, `CliError`, `CliErrorCode`.
12. **Gates.** `bun run test` (cli), `bun run typecheck`, `bun run lint`,
    `bun run build` for cli; then full monorepo
    `bun run test/typecheck/lint/build` (16 projects).

## 7. Edge cases

- **No config file found.** `inspect` and `plan` use auto-discovery.
  `execute` uses auto-discovery. `validate` exits with 2
  (`CONFIG_NOT_FOUND`).
- **`init` with existing config.** Exit 2 (`CONFIG_EXISTS`) unless
  `--force`.
- **`execute` with empty findings.** Verdict is from policy evaluation
  with empty findings → `policy.default` (usually "pass"). Exit 0.
- **`execute` with `--executor docker` but Docker not installed.** The
  SDK's `DockerExecutor` will throw → wrapped as `CliError(SDK_ERROR)`
  → exit 3. (Or check first and throw `RUNTIME_NOT_AVAILABLE`.)
- **`baseline show` with no baseline file.** `loadBaseline` throws
  `BaselineError` → wrapped as `CliError(SDK_ERROR)` → exit 3.
- **`baseline clear` with no baseline file.** Silently succeed (idempotent
  — `fs.unlink` with `ignoreEnoent` or catch ENOENT).
- **`--format json` with `--quiet`.** JSON still goes to stdout (quiet
  only suppresses human-format non-essential output, not the result).
  Actually: `--quiet` suppresses ALL stdout in human format. In JSON
  format, the JSON result is always emitted (it's the data). Error
  messages still go to stderr.
- **`doctor` with missing git.** Print "git: NOT FOUND". Exit 3.
- **yargs help/version.** yargs provides `--help` and `--version`
  automatically. These exit with 0.

## 8. Test plan → spec mapping

| Spec test plan | File | Notes |
|---|---|---|
| 1 global flags | `main.test.ts` | format, quiet, verbose, root, config |
| 2 init | `init.test.ts` | create, exists, force, template |
| 3 inspect | `inspect.test.ts` | human, json |
| 4 plan | `plan.test.ts` | prints plan, no execution |
| 5 execute/run | `execute.test.ts` | exit codes, executor, only-new, baseline, json |
| 6 validate | `validate.test.ts` | valid, invalid, missing |
| 7 baseline | `baseline.test.ts` | create, update, show, clear |
| 8 doctor | `doctor.test.ts` | all pass, missing tool |
| 9 exit codes | `main.test.ts` | 0/1/2/3 |
| 10 error handling | `main.test.ts` | unknown command, missing arg, SDK error wrap |

## 9. Acceptance

- All CLI tests pass (`bun run test` for cli).
- Full monorepo green: test, typecheck, lint, build across 16 projects.
- `src/index.ts` exports `main`, `GlobalFlags`, `OutputWriter`, `ExitCode`,
  `CliError`, `CliErrorCode`; no `any`.
- `override` on `cause` in `CliError` (noImplicitOverride).
- `main()` returns exit code (does not call `process.exit`).
- 7 commands work: `init`, `inspect`, `plan`, `execute`/`run`, `validate`,
  `baseline`, `doctor`.
- `--format json` produces valid JSON on stdout.
- `--format human` produces readable text.
- `--quiet` suppresses non-error stdout.
- `@sverka/sdk` and `yargs` dependencies added.
- No new external dependencies beyond `yargs`.
