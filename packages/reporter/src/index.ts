// @sverka/reporter — public barrel. Spec 43.

// Types
export type {
  Renderer,
  UIState,
  StepUIState,
  StepState,
  DiagnosticEntry,
  FindingRow,
  FindingsCollectorOptions,
  PolicyGateOptions,
  PolicyGateResult,
  TextRendererOptions,
  TextWriter,
} from "./types.js";

// Errors
export { ReporterError } from "./errors.js";
export type { ReporterErrorCode } from "./errors.js";

// EventReducer (pure)
export { reduceEvent, createInitialState } from "./reducer.js";

// FindingsCollector (I/O)
export { collectFindings } from "./findings-collector.js";

// PolicyGate (pure)
export { evaluateGate } from "./policy-gate.js";

// TextRenderer (I/O)
export { createTextRenderer } from "./text-renderer.js";
