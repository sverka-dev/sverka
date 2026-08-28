// Standalone helpers that don't depend on runtime packages.
import type { Operation } from "@sverka/workflow";
import type { WorkflowDefinition } from "./types.js";

/** Name an operation. Sugar for `op.named(name)`. */
export function task(name: string, op: Operation): Operation {
  return op.named(name);
}

/** Type-safe helper for sverka.config.ts. Identity function. */
export function defineWorkflow(
  definition: WorkflowDefinition,
): WorkflowDefinition {
  return definition;
}
