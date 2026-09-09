// @sverka/sarif-viewer-web — file I/O wrapper. Spec 47.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { generateSarifHtml } from "./html-generator.js";
import { resolveFindings } from "./input.js";
import type { SarifWebOptions } from "./types.js";

// Re-export the pure HTML generator for backward compatibility.
export { generateSarifHtml } from "./html-generator.js";

/**
 * Resolve `options` into findings, generate HTML, and write to
 * `options.outputPath`. Creates parent directories if needed.
 *
 * @throws {Error} when the file cannot be written.
 */
export function renderSarifWeb(options: SarifWebOptions): void {
  const findings = resolveFindings(options);
  const html = generateSarifHtml(findings);
  mkdirSync(dirname(options.outputPath), { recursive: true });
  writeFileSync(options.outputPath, html, "utf-8");
}
