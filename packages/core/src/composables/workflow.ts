import type { Operation } from "../operation.js";
import type { Runtime, RuntimeResult } from "../runtime.js";
import { planWorkflow } from "../internal/plan.js";

/** A frozen workflow definition that can be planned, executed, or compiled. */
export interface Workflow {
  readonly name: string;
  readonly roots: readonly Operation[];
  /** Evaluate this workflow under the given runtime. */
  readonly plan: (runtime: Runtime) => Promise<RuntimeResult>;
}

/**
 * Define a named workflow from a set of root operations. The workflow is the
 * top-level composable that the planner and CLI accept. Returns a frozen
 * workflow object.
 *
 * @example
 * const wf = workflow("ci", parallel(build, lint), pipeline(test, report));
 */
export function workflow(name: string, ...roots: Operation[]): Workflow {
  const frozenRoots: readonly Operation[] = Object.freeze([...roots]);
  return Object.freeze({
    name,
    roots: frozenRoots,
    plan: (runtime: Runtime) => planWorkflow(frozenRoots, runtime),
  }) as Workflow;
}
