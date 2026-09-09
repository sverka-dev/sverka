// @sverka/reporter — EventReducer (pure). Spec 43.

import type { RunEvent } from "@sverka/runtime";
import type { UIState, StepUIState, DiagnosticEntry } from "./types.js";

/** Create an empty UIState. */
export function createInitialState(): UIState {
  return {
    runId: null,
    planId: null,
    status: null,
    durationMs: null,
    steps: new Map(),
    diagnostics: [],
  };
}

/** Pure function: accumulate a RunEvent into the current UIState. */
export function reduceEvent(state: UIState, event: RunEvent): UIState {
  switch (event.type) {
    case "run-started":
      return { ...state, runId: event.runId, planId: event.planId };

    case "step-pending":
      return withStep(state, event.stepId, { stepId: event.stepId, state: "pending" });

    case "step-ready":
      return withStep(state, event.stepId, { stepId: event.stepId, state: "ready" });

    case "step-started":
      return withStep(state, event.stepId, { stepId: event.stepId, state: "running" });

    case "step-succeeded":
      return withStep(state, event.stepId, {
        stepId: event.stepId,
        state: "succeeded",
        durationMs: event.durationMs,
      });

    case "step-failed":
      return withStep(state, event.stepId, {
        stepId: event.stepId,
        state: "failed",
        durationMs: event.durationMs,
        error: event.error,
      });

    case "step-skipped":
      return withStep(state, event.stepId, { stepId: event.stepId, state: "skipped" });

    case "step-cancelled":
      return withStep(state, event.stepId, { stepId: event.stepId, state: "cancelled" });

    case "step-cache-hit":
      return withStep(state, event.stepId, { stepId: event.stepId, state: "cache-hit" });

    case "step-retry":
      return withStep(state, event.stepId, {
        stepId: event.stepId,
        state: "running",
        attempt: event.attempt,
      });

    case "step-suspended":
      return withStep(state, event.stepId, { stepId: event.stepId, state: "suspended" });

    case "step-compensating":
      return withStep(state, event.stepId, { stepId: event.stepId, state: "compensating" });

    case "step-compensated":
      return withStep(state, event.stepId, {
        stepId: event.stepId,
        state: "compensated",
        durationMs: event.durationMs,
      });

    case "run-completed":
      return { ...state, status: event.status, durationMs: event.durationMs };

    case "run-suspended":
      return { ...state, status: "suspended", durationMs: event.durationMs };

    case "run-resumed":
      return { ...state, status: null, durationMs: null };

    case "diagnostic": {
      const entry: DiagnosticEntry = {
        stepId: event.stepId,
        message: event.message,
        severity: event.severity,
      };
      return { ...state, diagnostics: [...state.diagnostics, entry] };
    }

    default:
      return state;
  }
}

/** Update a single step in the state, returning a new UIState. */
function withStep(state: UIState, stepId: string, step: StepUIState): UIState {
  const steps = new Map(state.steps);
  steps.set(stepId, step);
  return { ...state, steps };
}
