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
  DagNode,
  DagEdge,
  DagLayoutResult,
  DagLayoutOptions,
  HtmlRendererOptions,
  FindingFilter,
  StepGlyph,
  StepTreeRow,
  InkRenderer,
  InkRendererOptions,
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

// DagLayout (pure) — Spec 44
export { layoutDag } from "./dag-layout.js";

// HtmlRenderer (I/O) — Spec 44
export { createHtmlRenderer } from "./html-renderer.js";

// TUI model (pure) — Spec 45
export { stepGlyph, buildStepTree, filterFindings, searchFindings, FINDING_FILTERS } from "./tui-model.js";

// InkRenderer (I/O) — Spec 45
export { createInkRenderer } from "./ink-renderer.js";
