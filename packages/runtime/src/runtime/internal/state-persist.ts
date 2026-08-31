import type { StateStore } from "../state-store.js";
import type { OperationOutcome } from "../result.js";
import { SchedulerError } from "../errors.js";

export interface PersistState {
  planId: string;
  completed: string[];
  failed: string[];
  skipped: string[];
  running: string[];
  outcomes: Map<string, OperationOutcome>;
}

/**
 * Load prior execution state for resume. Returns undefined if no state store
 * is configured, resume is disabled, or no prior state exists.
 */
export async function loadPersistedState(
  stateStore: StateStore | undefined,
  resume: boolean,
  planId: string,
): Promise<
  | { completed: readonly string[]; outcomes: ReadonlyMap<string, OperationOutcome> }
  | undefined
> {
  if (!stateStore || !resume) return undefined;
  let state;
  try {
    state = await stateStore.load(planId);
  } catch (e) {
    throw new SchedulerError("state store load failed", {
      code: "STATE_LOAD_ERROR",
      cause: e instanceof Error ? e.message : String(e),
    });
  }
  if (!state) return undefined;
  return { completed: state.completed, outcomes: state.outcomes };
}

/** Clear persisted state on successful completion (best-effort). */
export async function clearPersistedState(
  stateStore: StateStore | undefined,
  planId: string,
): Promise<void> {
  if (!stateStore) return;
  try {
    await stateStore.clear(planId);
  } catch (e) {
    console.warn("stateStore.clear failed:", e);
  }
}

/** Persist current execution state (best-effort). */
export async function persistState(
  stateStore: StateStore | undefined,
  state: PersistState,
): Promise<void> {
  if (!stateStore) return;
  try {
    await stateStore.save({
      planId: state.planId,
      completed: state.completed,
      failed: state.failed,
      skipped: state.skipped,
      running: state.running,
      outcomes: state.outcomes,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.warn("stateStore.save failed:", e);
  }
}
