// @sverka/sarif-viewer-tui — input resolution. Spec 46.

import { resolveSarifInput, type Finding } from "@sverka/verification";
import type { SarifTuiOptions } from "./types.js";

/**
 * Resolve `SarifTuiOptions` into a `Finding[]`. Exactly one of `sarif`,
 * `sarifPath`, `findings` must be provided.
 *
 * Delegates to `@sverka/verification`'s `resolveSarifInput` for the shared
 * resolution logic (file reading, JSON parsing, normalization).
 *
 * @throws {Error} when zero or more than one input is provided.
 * @throws {NormalizationError} when SARIF is invalid (propagated).
 * @throws {Error} when the file cannot be read or parsed.
 */
export function resolveFindings(options: SarifTuiOptions): Finding[] {
  return resolveSarifInput(options);
}
