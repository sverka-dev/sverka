import type { ExecutionState } from "./result.js";

/**
 * Persists execution state so an interrupted run can resume. Implementations
 * may use the filesystem, SQLite, or an in-memory mock for testing. When
 * omitted from SchedulerConfig, the scheduler does not persist state.
 *
 * **Serialization note:** `ExecutionState.outcomes` is a `ReadonlyMap`, which
 * is not directly JSON-serializable. Filesystem/JSON-backed implementations
 * must convert the Map to a plain object (or array of entries) on save and
 * reconstruct it on load. The in-memory mock used in tests stores the Map
 * directly.
 *
 * **Lifecycle note:** The scheduler calls `save()` after each operation
 * completes and calls `clear()` after a fully successful run (state is no
 * longer needed for resume). On partial/failure/cancelled runs, the state is
 * retained so a subsequent `resume: true` execution can pick up where it
 * left off. Callers may also call `clear()` manually to free storage.
 */
export interface StateStore {
  save(state: ExecutionState): Promise<void>;
  load(planId: string): Promise<ExecutionState | undefined>;
  clear(planId: string): Promise<void>;
}
