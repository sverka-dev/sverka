import type { CoreError } from "./errors.js";
import type { OperationSpec } from "./operation.js";

/**
 * The mode in which a Runtime evaluates the workflow graph.
 */
export type RuntimeMode = "plan" | "execute" | "compile";

/**
 * The result of evaluating a workflow graph under a Runtime.
 */
export interface RuntimeResult {
  readonly mode: RuntimeMode;
  readonly operations: readonly OperationSpec[];
  readonly outcomes?: readonly OperationOutcome[];
  readonly artifacts?: readonly Artifact[];
  readonly logs?: ReadonlyMap<string, string>;
  readonly errors?: readonly CoreError[];
  readonly durationMs: number;
}

/**
 * A named artifact produced during Execution or Compile mode.
 * In Compile mode, `content` holds the emitted artifact (e.g. YAML text).
 */
export interface Artifact {
  readonly name: string;
  readonly path?: string;
  readonly content?: string;
}

/**
 * The context made available to condition expressions during planning.
 * Keys are strings; values are primitives or arrays of primitives. The
 * planner populates this from project context (schedule, branch, env
 * flags, etc.). Condition expressions reference these keys by name.
 */
export interface PlanContext {
  readonly [key: string]:
    | string
    | number
    | boolean
    | readonly string[]
    | readonly number[]
    | readonly boolean[];
}

/**
 * The Runtime interface is the contract between the core graph and the
 * backend that interprets it. Executors, compilers, and the planner each
 * provide a Runtime implementation.
 *
 * In Plan mode the runtime records operations without side effects.
 * In Execution mode it executes operations through an executor.
 * In Compile mode it emits a target artifact via a compiler.
 */
export interface Runtime {
  readonly mode: RuntimeMode;
  /** Context for condition evaluation during planning. */
  readonly context?: PlanContext;
  /** Record or execute a single resolved operation. */
  evaluate(operation: OperationSpec): Promise<OperationOutcome>;
  /** Finalize and return the aggregate result. */
  finalize(): Promise<RuntimeResult>;
}

export interface OperationOutcome {
  readonly operationId: string;
  readonly status: "planned" | "success" | "failure" | "skipped" | "cancelled";
  readonly exitCode?: number;
  readonly durationMs: number;
  readonly logs?: string;
  readonly artifacts?: readonly string[];
  readonly error?: CoreError;
}
