// @sverka/sarif-viewer-web — public types. Spec 47.

import type { Finding, NormalizeContext } from "@sverka/verification";

/** Options for the standalone SARIF web report generator. Exactly one of
 *  `sarif`, `sarifPath`, `findings` must be provided. */
export interface SarifWebOptions {
  /** Pre-parsed SARIF object (validated by normalizeSarif). */
  readonly sarif?: unknown;
  /** Path to a `.sarif` file on disk. Read and normalized. */
  readonly sarifPath?: string;
  /** Pre-normalized findings — used directly, no normalization. */
  readonly findings?: readonly Finding[];
  /** Context for `normalizeSarif`. Defaults to
   *  `{ root: cwd, checkIdPrefix: "", defaultConfidence: 0.5 }`. */
  readonly context?: NormalizeContext;
  /** Where to write the HTML file. Required for `renderSarifWeb`. */
  readonly outputPath: string;
}
