import type { ExecutionState } from "./result.js";

/**
 * Persists execution state so an interrupted run can resume. Implementations
 * may use the filesystem, SQLite, or an in-memory mock for testing. When
 * omitted from SchedulerConfig, the scheduler does not persist state.
 */
export interface StateStore {
  save(state: ExecutionState): Promise<void>;
  load(planId: string): Promise<ExecutionState | undefined>;
  clear(planId: string): Promise<void>;
}
