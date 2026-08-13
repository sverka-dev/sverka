// Compatibility re-exports — delegate to the canonical types.
// This file exists to preserve the import path `@sverka/sdk/compat/types`
// for downstream consumers during the v0 migration.

export type {
  WorkflowDefinition,
  SverkaOptions,
  Sverka,
  PlanResult,
  ExecutionResult,
} from "../types.js";
