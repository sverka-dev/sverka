import type { Workflow, Operation, OperationSpec } from "@sverka/workflow";
import type { CheckResolver } from "@sverka/verification";
import type { ProjectContext, PlanProposal } from "./planner/index.js";
import type { Finding } from "@sverka/verification";
import type { Plan } from "@sverka/workflow";
import type { Verdict, PolicyResult, PolicyConfig } from "@sverka/verification";
import type { OperationOutcome } from "@sverka/runtime";

/**
 * A type-safe workflow definition for `sverka.config.ts`.
 */
export interface WorkflowDefinition {
  /** Workflow name. */
  name: string;
  /** The workflow graph. Accepts a Workflow or a bare Operation (wrapped automatically). */
  workflow: Workflow | Operation;
  /** Optional policy configuration. Defaults to DEFAULT_POLICY. */
  policy?: PolicyConfig;
}

/** Options for Sverka plan and execute operations. */
export interface SverkaOptions {
  /** Root directory. Defaults to process.cwd(). */
  root?: string;
  /** Path to sverka.config.ts. Defaults to findConfig(root). */
  configPath?: string;
  /** Executor backend. Defaults to "host". */
  executor?: "host" | "docker";
  /** Path to baseline file for only-new filtering. */
  baselinePath?: string;
  /** Only report findings not in the baseline. Default false. */
  onlyNew?: boolean;
  /** Git base ref for changed-file discovery (e.g. "main", "HEAD~1"). */
  baseRef?: string;
  /** Optional custom check resolver. Defaults to the built-in resolver. */
  resolver?: CheckResolver;
}

/** The Sverka instance returned by createSverka. */
export interface Sverka {
  plan(options?: SverkaOptions): Promise<PlanResult>;
  toPlan(options?: SverkaOptions): Promise<Plan>;
  execute(options?: SverkaOptions): Promise<ExecutionResult>;
}

/** Result of plan mode. */
export interface PlanResult {
  /** Discovered project context. */
  context: ProjectContext;
  /** Resolved operations from the workflow graph (empty if auto-discovery). */
  operations: readonly OperationSpec[];
  /** Planner proposal (null if a user config was loaded). */
  proposal: PlanProposal | null;
  /** Canonical Plan IR built from the resolved operations. */
  plan: Plan;
}

/** Result of execute mode. */
export interface ExecutionResult {
  /** Findings (empty until check providers exist — wave 11). */
  findings: readonly Finding[];
  /** Policy evaluation result. */
  policyResult: PolicyResult;
  /** Final verdict. */
  verdict: Verdict;
  /** Scheduler execution status. */
  status: "success" | "failure" | "partial";
  /**
   * True when at least one operation failed due to an executor-level runtime
   * fault (e.g., a binary could not be spawned). Distinguishes runtime errors
   * from policy/command failures.
   */
  runtimeFailure?: boolean;
  /** Per-operation outcomes (runtime's OperationOutcome with fromCache). */
  outcomes: ReadonlyMap<string, OperationOutcome>;
  /** Total execution time in ms. */
  durationMs: number;
}
