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

/** Update a single step in the state, returning a new UIState. */
function withStep(state: UIState, stepId: string, step: StepUIState): UIState {
  const steps = new Map(state.steps);
  steps.set(stepId, step);
  return { ...state, steps };
}

/** Handle run-level events. */
function reduceRunEvent(state: UIState, event: RunEvent): UIState | null {
  switch (event.type) {
    case "run-started":
      return { ...state, runId: event.runId, planId: event.planId };
    case "run-completed":
      return { ...state, status: event.status, durationMs: event.durationMs };
    case "run-suspended":
      return { ...state, status: "suspended", durationMs: event.durationMs };
    case "run-resumed":
      return { ...state, status: null, durationMs: null };
    default:
      return null;
  }
}

/** Handle step-level events. */
function reduceStepEvent(state: UIState, event: RunEvent): UIState | null {
  const simpleStates: Record<string, string> = {
    "step-pending": "pending",
    "step-ready": "ready",
    "step-started": "running",
    "step-skipped": "skipped",
    "step-cancelled": "cancelled",
    "step-cache-hit": "cache-hit",
    "step-suspended": "suspended",
    "step-compensating": "compensating",
  };
  const simpleState = simpleStates[event.type];
  if (simpleState) {
    const stepId = (event as { stepId: string }).stepId;
    return withStep(state, stepId, { stepId, state: simpleState as StepUIState["state"] });
  }

  switch (event.type) {
    case "step-succeeded":
      return withStep(state, event.stepId, {
        stepId: event.stepId, state: "succeeded", durationMs: event.durationMs,
      });
    case "step-failed":
      return withStep(state, event.stepId, {
        stepId: event.stepId, state: "failed", durationMs: event.durationMs, error: event.error,
      });
    case "step-retry":
      return withStep(state, event.stepId, {
        stepId: event.stepId, state: "running", attempt: event.attempt,
      });
    case "step-compensated":
      return withStep(state, event.stepId, {
        stepId: event.stepId, state: "compensated", durationMs: event.durationMs,
      });
    default:
      return null;
  }
}

/** Handle diagnostic events. */
function reduceDiagnostic(state: UIState, event: RunEvent): UIState | null {
  if (event.type !== "diagnostic") return null;
  const entry: DiagnosticEntry = {
    stepId: event.stepId,
    message: event.message,
    severity: event.severity,
  };
  return { ...state, diagnostics: [...state.diagnostics, entry] };
}

/** Pure function: accumulate a RunEvent into the current UIState. */
export function reduceEvent(state: UIState, event: RunEvent): UIState {
  return (
    reduceRunEvent(state, event) ??
    reduceStepEvent(state, event) ??
    reduceDiagnostic(state, event) ??
    state
  );
}
