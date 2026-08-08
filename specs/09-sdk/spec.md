# Spec 09 — SDK Package: Public TypeScript API

## Overview

The `sdk` package is the public TypeScript API surface for Sverka. It
re-exports the core composables (`pipeline`, `task`, `run`, `parallel`, `when`,
`matrix`, `workflow`) from `@sverka/core` and provides a single entry point
for users who want to define verification workflows in code. It also defines
the workflow definition file format (`sverka.config.ts`) and the three
operating modes: plan, execution, and compile.

The SDK is what users import. It is a thin facade over `@sverka/core`,
`@sverka/planner`, `@sverka/findings`, `@sverka/policy`, and the runtime
packages. It does not contain business logic itself; it wires the other
packages together and presents a clean, ergonomic API.

## Goals

1. Provide a single import path (`@sverka/sdk`) for all user-facing API.
2. Re-export core composables: `pipeline`, `task`, `run`, `parallel`, `when`,
   `matrix`, `workflow`.
3. Define the workflow definition file format (`sverka.config.ts`).
4. Support three operating modes: plan (discover and synthesize without
   executing), execution (run checks locally), and compile (emit CI pipeline
   files).
5. Provide ergonomic defaults so a project can start with zero configuration.
6. Re-export types from `findings` and `policy` so users do not need multiple
   imports.
7. Provide a `defineWorkflow` helper for type-safe workflow definitions.
8. Export all public types and functions from `src/index.ts`.

## Non-goals (v1)

- Implementing workflow graph logic (that lives in `@sverka/core`).
- Implementing discovery logic (that lives in `@sverka/planner`).
- Implementing finding normalization (that lives in `@sverka/findings`).
- Providing a GUI or visual workflow editor.
- Supporting non-TypeScript workflow definitions.
- Embedding runtime executors directly (those are selected at runtime).

## Interfaces

```typescript
/**
 * Re-exported core composables.
 */
export { pipeline, task, run, parallel, when, matrix, workflow } from "@sverka/core";

/**
 * Re-exported core types.
 */
export type {
  Pipeline,
  Task,
  Operation,
  Workflow,
  WorkflowNode,
  MatrixStrategy,
  Condition,
} from "@sverka/core";

/**
 * Re-exported findings types.
 */
export type { Finding, Severity, FindingSource } from "@sverka/findings";

/**
 * Re-exported policy types.
 */
export type { Policy, PolicyResult, Verdict, FailOnRule, CustomRule } from "@sverka/policy";

/**
 * Re-exported planner types.
 */
export type { ProjectContext, DiscoverOptions, PlanProposal } from "@sverka/planner";

/**
 * The main entry point for running Sverka in a specific mode.
 */
export interface Sverka {
  /**
   * Discover project context and synthesize a plan without executing.
   */
  plan(options?: SverkaOptions): Promise<PlanResult>;

  /**
   * Execute the workflow locally and produce findings.
   */
  execute(options?: SverkaOptions): Promise<ExecutionResult>;

  /**
   * Compile the workflow to a CI target.
   */
  compile(options?: CompileOptions): Promise<CompileResult>;
}

/**
 * Options common to plan and execute modes.
 */
export interface SverkaOptions {
  /** Root directory. Defaults to process.cwd(). */
  root?: string;
  /** Path to sverka.config.ts. Defaults to auto-discovery. */
  configPath?: string;
  /** Whether to enable remote discovery. */
  remote?: boolean;
  /** Provider credentials. */
  credentials?: ProviderCredentials;
  /** Path to baseline file. */
  baselinePath?: string;
  /** Whether to only report new findings. */
  onlyNew?: boolean;
  /** Output format. */
  output?: "human" | "json" | "sarif";
}

/**
 * Options for compile mode.
 */
export interface CompileOptions extends SverkaOptions {
  /** Compilation target. */
  target: "github-actions" | "gitlab-ci";
  /** Output directory for compiled files. */
  outputDir: string;
}

/**
 * Result of plan mode.
 */
export interface PlanResult {
  context: ProjectContext;
  proposal: PlanProposal;
  output: string;
}

/**
 * Result of execution mode.
 */
export interface ExecutionResult {
  findings: Finding[];
  policyResult: PolicyResult;
  verdict: Verdict;
  output: string;
}

/**
 * Result of compile mode.
 */
export interface CompileResult {
  target: string;
  files: CompiledFile[];
  output: string;
}

/**
 * A file produced by compilation.
 */
export interface CompiledFile {
  path: string;
  content: string;
}

/**
 * Provider credentials (re-exported from planner).
 */
export type { ProviderCredentials } from "@sverka/planner";

/**
 * Creates a Sverka instance for programmatic use.
 * @param options Default options applied to all modes.
 */
export function createSverka(options?: SverkaOptions): Sverka;

/**
 * Top-level convenience functions that use a default Sverka instance.
 */
export function plan(options?: SverkaOptions): Promise<PlanResult>;
export function execute(options?: SverkaOptions): Promise<ExecutionResult>;
export function compile(options: CompileOptions): Promise<CompileResult>;

/**
 * Type-safe helper for defining a workflow in sverka.config.ts.
 * @param definition The workflow definition.
 * @returns The same definition, typed for export.
 */
export function defineWorkflow(definition: WorkflowDefinition): WorkflowDefinition;

/**
 * The structure of a sverka.config.ts file.
 */
export interface WorkflowDefinition {
  /** Workflow name. */
  name: string;
  /** The pipeline or workflow graph. */
  workflow: Workflow;
  /** Optional policy configuration. */
  policy?: PolicyConfig;
  /** Optional planner overrides. */
  planner?: {
    remote?: boolean;
    exclude?: string[];
  };
}

/**
 * Policy configuration (re-exported from policy).
 */
export type { PolicyConfig } from "@sverka/policy";

/**
 * The workflow definition file format.
 *
 * A sverka.config.ts file must have a default export that is a
 * WorkflowDefinition, typically created via defineWorkflow():
 *
 * ```typescript
 * import { defineWorkflow, pipeline, task, run } from "@sverka/sdk";
 *
 * export default defineWorkflow({
 *   name: "verify",
 *   workflow: pipeline([
 *     task("lint", run("bun", ["run", "lint"])),
 *     task("typecheck", run("bun", ["run", "typecheck"])),
 *     task("test", run("bun", ["test"])),
 *   ]),
 *   policy: {
 *     failOn: [{ severity: "high", onlyNew: false }],
 *   },
 * });
 * ```
 */

/**
 * Loads a workflow definition from a sverka.config.ts file.
 * @param configPath Path to the config file.
 * @returns The loaded workflow definition.
 */
export function loadWorkflow(configPath: string): Promise<WorkflowDefinition>;

/**
 * Auto-discovers the workflow config file by searching upward from the
 * root directory.
 * @param root The root directory to search from.
 * @returns Path to the config file, or null if not found.
 */
export function findConfig(root: string): Promise<string | null>;

/**
 * Error thrown when SDK operations fail.
 */
export class SdkError extends Error {
  readonly code: string;
  readonly cause: unknown;
  constructor(message: string, code: string, cause?: unknown) {
    super(message);
    this.name = "SdkError";
    this.code = code;
    this.cause = cause;
  }
}
```

## Data models

### Workflow definition file format

The `sverka.config.ts` file is the user's entry point. It must:

1. Be a TypeScript file with a **default export** of type `WorkflowDefinition`.
2. Use the `defineWorkflow` helper for type safety and IDE autocomplete.
3. Be loadable via `loadWorkflow(configPath)`, which dynamically imports the
   file and validates its default export.

File discovery order (via `findConfig`):

1. `sverka.config.ts` in the root directory.
2. `sverka.config.ts` in parent directories (up to 5 levels).
3. `sverka.config.js` (compiled output) as a fallback.

If no config file is found, Sverka operates in **auto-discovery mode**: the
planner discovers project context and synthesizes a plan with built-in checks
based on detected languages, frameworks, and package managers.

### Operating modes

#### Plan mode

1. Discover `ProjectContext` via `@sverka/planner`.
2. Load the workflow definition from `sverka.config.ts` if present; otherwise
   use auto-discovery.
3. Synthesize a `PlanProposal`.
4. Return a `PlanResult` with context, proposal, and formatted output.
5. **No checks are executed.** No side effects.

#### Execution mode

1. Discover `ProjectContext` via `@sverka/planner`.
2. Load the workflow definition if present.
3. Resolve the plan IR from the workflow definition and context.
4. Execute the plan via the appropriate runtime (Docker, Podman, host, remote).
5. Collect raw findings from all checks.
6. Normalize findings via `@sverka/findings`.
7. Apply baseline and `--only-new` filtering if configured.
8. Evaluate findings against the policy via `@sverka/policy`.
9. Return an `ExecutionResult` with findings, policy result, verdict, and
   formatted output.

#### Compile mode

1. Discover `ProjectContext` via `@sverka/planner`.
2. Load the workflow definition.
3. Resolve the plan IR.
4. Compile the IR to the target CI format via the appropriate compiler
   (`@sverka/compiler-github` or `@sverka/compiler-gitlab`).
5. Write compiled files to `outputDir`.
6. Return a `CompileResult` with target, files, and formatted output.

### Composable re-exports

The SDK re-exports the following composables from `@sverka/core` without
modification:

| Composable | Purpose |
|---|---|
| `pipeline` | Define a sequence of tasks that run in order. |
| `task` | Define a single task with a name and operation. |
| `run` | Define a shell command execution operation. |
| `parallel` | Run multiple tasks concurrently. |
| `when` | Conditionally include a task based on a predicate. |
| `matrix` | Expand a task across a matrix of values. |
| `workflow` | Define a complete workflow graph from named nodes. |

These composables are lazy: they build a graph structure, they do not execute.
Execution happens only in execution mode when the runtime processes the
resolved IR.

### `createSverka` vs top-level functions

- `createSverka(options)` returns a `Sverka` instance with default options
  pre-applied. Useful for programmatic use where the same options are used
  across multiple calls.
- Top-level `plan()`, `execute()`, `compile()` functions create a default
  `Sverka` instance per call. Useful for CLI and one-off scripts.

## Error handling

- **`SdkError`** is thrown for SDK-level failures:
  - `CONFIG_NOT_FOUND` — no `sverka.config.ts` found and auto-discovery is
    disabled.
  - `CONFIG_INVALID` — the config file's default export does not conform to
    `WorkflowDefinition`.
  - `CONFIG_LOAD_FAILED` — the config file could not be loaded (syntax error,
    missing dependency).
  - `MODE_INVALID` — an invalid mode was specified.
  - `COMPILE_TARGET_INVALID` — an unsupported compile target was specified.
  - `EXECUTION_FAILED` — a runtime error occurred during execution (wrapped
    from the runtime package).
- **Config loading errors are wrapped.** If `loadWorkflow` fails to import the
  config file, the original error is preserved in `cause`.
- **Auto-discovery mode never throws `CONFIG_NOT_FOUND`.** It only throws if
  discovery itself fails (wrapped as `DiscoveryError` from the planner).
- All errors include a `cause` field typed as `unknown`.
- No `any` types are used.

## Test plan

Tests live in `packages/sdk/src/__tests__/` and run via `bun test`.

1. **Re-exports:**
   - `pipeline`, `task`, `run`, `parallel`, `when`, `matrix`, `workflow` are
     exported and callable.
   - Core types (`Pipeline`, `Task`, `Operation`, `Workflow`) are exported.
   - Findings types (`Finding`, `Severity`) are exported.
   - Policy types (`Policy`, `PolicyResult`, `Verdict`) are exported.
   - Planner types (`ProjectContext`, `DiscoverOptions`) are exported.
2. **`defineWorkflow`:**
   - Returns the same definition object passed in.
   - TypeScript infers the correct type.
   - A definition with missing required fields is a type error.
3. **`loadWorkflow`:**
   - Loads a valid `sverka.config.ts` and returns a `WorkflowDefinition`.
   - Throws `CONFIG_INVALID` when the default export is malformed.
   - Throws `CONFIG_LOAD_FAILED` when the file has a syntax error.
   - Throws `CONFIG_NOT_FOUND` when the file does not exist.
4. **`findConfig`:**
   - Finds `sverka.config.ts` in the root directory.
   - Finds `sverka.config.ts` in a parent directory.
   - Falls back to `sverka.config.js`.
   - Returns `null` when no config is found within 5 levels.
5. **Plan mode:**
   - Returns a `PlanResult` with context and proposal.
   - Does not execute any checks.
   - Works with auto-discovery when no config is present.
   - Works with a user-supplied config.
6. **Execution mode:**
   - Returns an `ExecutionResult` with findings and verdict.
   - Applies baseline filtering when `onlyNew` is true.
   - Evaluates policy and produces correct verdict.
   - Output format respects `output` option.
7. **Compile mode:**
   - Returns a `CompileResult` with compiled files.
   - `target: "github-actions"` produces GitHub Actions YAML.
   - `target: "gitlab-ci"` produces GitLab CI YAML.
   - Files are written to `outputDir`.
   - Invalid target throws `COMPILE_TARGET_INVALID`.
8. **`createSverka`:**
   - Default options are applied to subsequent `plan`/`execute`/`compile`
     calls.
   - Per-call options override defaults.
9. **Auto-discovery mode:**
   - Works with zero configuration.
   - Produces a valid plan based on detected project context.
10. **Error cases:**
    - `CONFIG_NOT_FOUND` when auto-discovery is disabled and no config exists.
    - `CONFIG_INVALID` for malformed default export.
    - `CONFIG_LOAD_FAILED` wraps the original error in `cause`.
    - `EXECUTION_FAILED` wraps runtime errors.
