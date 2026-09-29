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
    startedAt: null,
    finishedAt: null,
    steps: new Map(),
    diagnostics: [],
  };
}

/** Tail cap for captured step output — keeps report size bounded. */
const OUTPUT_TAIL_BYTES = 64 * 1024;

/** Keep at most the last N *bytes* of UTF-8 output (the suffix is the
 * most relevant part). Byte-accurate: a multi-byte character at the cut
 * point decodes to a replacement char rather than exceeding the cap. */
function tail(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const buf = Buffer.from(text, "utf8");
  return buf.length <= OUTPUT_TAIL_BYTES
    ? text
    : buf.subarray(buf.length - OUTPUT_TAIL_BYTES).toString("utf8");
}

/** Step patch: optional fields may be spelled as explicit undefined. */
type StepPatch = {
  [K in keyof StepUIState]?: StepUIState[K] | undefined;
} & { stepId: string };

/** Update a single step in the state, returning a new UIState. */
function withStep(state: UIState, stepId: string, patch: StepPatch): UIState {
  const steps = new Map(state.steps);
  // Drop undefined fields — a missing event field must not clobber data
  // captured by earlier events (exactOptionalPropertyTypes also demands it).
  const clean = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  ) as StepPatch;
  steps.set(stepId, { ...steps.get(stepId), ...clean } as StepUIState);
  return { ...state, steps };
}

/** Handle run-level events. */
function reduceRunEvent(state: UIState, event: RunEvent): UIState | null {
  switch (event.type) {
    case "run-started":
      return {
        ...state,
        runId: event.runId,
        planId: event.planId,
        startedAt: event.at ?? null,
      };
    case "run-completed":
      return {
        ...state,
        status: event.status,
        durationMs: event.durationMs,
        finishedAt: event.at ?? null,
      };
    case "run-suspended":
      return {
        ...state,
        status: "suspended",
        durationMs: event.durationMs,
        finishedAt: event.at ?? null,
      };
    case "run-resumed":
      return { ...state, status: null, durationMs: null, finishedAt: null };
    default:
      return null;
  }
}

/** Handle step-level events. */
function reduceStepEvent(state: UIState, event: RunEvent): UIState | null {
  const simpleStates: Record<string, string> = {
    "step-pending": "pending",
    "step-ready": "ready",
    "step-skipped": "skipped",
    "step-cancelled": "cancelled",
    "step-suspended": "suspended",
    "step-compensating": "compensating",
  };
  const simpleState = simpleStates[event.type];
  if (simpleState) {
    const stepId = (event as { stepId: string }).stepId;
    return withStep(state, stepId, {
      stepId,
      state: simpleState as StepUIState["state"],
    });
  }

  switch (event.type) {
    // started/cache-hit carry `at` → startedAt for the timeline view
    case "step-started":
      return withStep(state, event.stepId, {
        stepId: event.stepId,
        state: "running",
        startedAt: event.at,
      });
    case "step-cache-hit":
      return withStep(state, event.stepId, {
        stepId: event.stepId,
        state: "cache-hit",
        startedAt: event.at,
      });
    case "step-succeeded":
      return withStep(state, event.stepId, {
        stepId: event.stepId,
        state: "succeeded",
        durationMs: event.durationMs,
        finishedAt: event.at,
        stdout: tail(event.stdout),
        stderr: tail(event.stderr),
        exitCode: event.exitCode,
      });
    case "step-failed":
      return withStep(state, event.stepId, {
        stepId: event.stepId,
        state: "failed",
        durationMs: event.durationMs,
        finishedAt: event.at,
        error: event.error,
        stdout: tail(event.stdout),
        stderr: tail(event.stderr),
        exitCode: event.exitCode,
      });
    case "step-retry":
      return withStep(state, event.stepId, {
        stepId: event.stepId,
        state: "running",
        attempt: event.attempt,
      });
    case "step-compensated":
      return withStep(state, event.stepId, {
        stepId: event.stepId,
        state: "compensated",
        durationMs: event.durationMs,
        finishedAt: event.at,
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
