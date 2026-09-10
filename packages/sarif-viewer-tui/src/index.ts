// @sverka/sarif-viewer-tui — public barrel. Spec 46.

// Types
export type {
  SarifTuiOptions,
  ViewerFilter,
  SortMode,
} from "./types.js";

// Component (for embedding in other Ink apps)
export { SarifTuiApp, TuiStore } from "./viewer.js";

// Programmatic render entry point
export { renderSarifTui } from "./render.js";

// Pure helpers (for reuse/testing)
export {
  SEVERITY_FILTERS,
  severityRank,
  filterBySeverity,
  searchFindings,
  sortFindings,
} from "./filter-model.js";

// Input resolution
export { resolveFindings } from "./input.js";
export { DEFAULT_NORMALIZE_CONTEXT } from "@sverka/verification";
