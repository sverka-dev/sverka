// @sverka/sarif-viewer-web — public barrel. Spec 47.

// Types
export type { SarifWebOptions } from "./types.js";

// Pure HTML generation (no I/O)
export { generateSarifHtml } from "./viewer.js";

// File I/O wrapper
export { renderSarifWeb } from "./viewer.js";

// Input resolution
export { resolveFindings, DEFAULT_NORMALIZE_CONTEXT } from "./input.js";
