// @sverka/sarif-viewer-web — input resolution. Spec 47.

import { resolveSarifInput, type Finding } from "@sverka/verification";
import type { SarifWebOptions } from "./types.js";

/**
 * Resolve `SarifWebOptions` (minus `outputPath`) into a `Finding[]`. Exactly
 * one of `sarif`, `sarifPath`, `findings` must be provided.
 *
 * Delegates to `@sverka/verification`'s `resolveSarifInput` for the shared
 * resolution logic (file reading, JSON parsing, normalization).
 *
 * @throws {Error} when zero or more than one input is provided.
 * @throws {NormalizationError} when SARIF is invalid (propagated).
 * @throws {Error} when the file cannot be read or parsed.
 */
export function resolveFindings(options: Omit<SarifWebOptions, "outputPath">): Finding[] {
  return resolveSarifInput(options);
}
