// @sverka/sarif-viewer-web — public barrel. Spec 47.

// Types
export type { SarifWebOptions } from "./types.js";

// Pure HTML generation (no I/O) — browser-safe
export { generateSarifHtml } from "./html-generator.js";

// File I/O wrapper (Node.js only)
export { renderSarifWeb } from "./viewer.js";

// Input resolution (Node.js only)
export { resolveFindings } from "./input.js";
export { DEFAULT_NORMALIZE_CONTEXT } from "@sverka/verification";
