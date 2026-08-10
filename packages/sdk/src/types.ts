import type { Workflow, Operation } from "@sverka/core";
import type { OperationSpec } from "@sverka/core";
import type { ProjectContext, PlanProposal } from "@sverka/planner";
import type { Finding } from "@sverka/findings";
import type { Verdict, PolicyResult, PolicyConfig } from "@sverka/policy";
import type { OperationOutcome as RuntimeOperationOutcome } from "@sverka/runtime";

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
}

/** The Sverka instance returned by createSverka. */
export interface Sverka {
  plan(options?: SverkaOptions): Promise<PlanResult>;
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
  /** Per-operation outcomes (runtime's OperationOutcome with fromCache). */
  outcomes: ReadonlyMap<string, RuntimeOperationOutcome>;
  /** Total execution time in ms. */
  durationMs: number;
}
