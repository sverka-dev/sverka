// @sverka/sarif-viewer-tui — public types. Spec 46.

import type { Finding, NormalizeContext, SarifLog } from "@sverka/verification";

/** Options for the standalone SARIF TUI. Exactly one of `sarif`, `sarifPath`,
 *  `findings` must be provided. */
export interface SarifTuiOptions {
  /** Pre-parsed SARIF object. Normalized via `normalizeSarif`. */
  readonly sarif?: SarifLog;
  /** Path to a `.sarif` file on disk. Read and normalized. */
  readonly sarifPath?: string;
  /** Pre-normalized findings — used directly, no normalization. */
  readonly findings?: readonly Finding[];
  /** Context for `normalizeSarif`. Defaults to
   *  `{ root: cwd, checkIdPrefix: "", defaultConfidence: 0.5 }`. */
  readonly context?: NormalizeContext;
}

/** Severity filter cycled by the `f` key. */
export type ViewerFilter =
  | "all"
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "info";

/** Sort mode cycled by the `s` key. */
export type SortMode = "none" | "severity" | "file" | "rule";
