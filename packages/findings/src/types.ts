/**
 * A normalized finding from any analysis tool.
 */
export interface Finding {
  /** Stable unique identifier: `{checkId}:{fingerprint}`. */
  id: string;
  /** Deterministic fingerprint used for baseline tracking. */
  fingerprint: string;
  /** Identifier of the check that produced this finding. */
  checkId: string;
  /** Severity level. */
  severity: Severity;
  /** Confidence level (0.0–1.0). Defaults to 0.5 for SARIF. */
  confidence: number;
  /** Human-readable message describing the finding. */
  message: string;
  /** Rule identifier from the originating tool. */
  rule: string;
  /** File path relative to project root, forward slashes. */
  file: string;
  /** Start line (1-based). */
  startLine: number;
  /** End line (1-based, inclusive). */
  endLine: number;
  /** Optional start column (1-based). */
  startColumn?: number;
  /** Optional end column (1-based). */
  endColumn?: number;
  /** Optional URL to documentation or remediation help. */
  helpUrl?: string;
  /** Source tool that produced the finding. */
  source: FindingSource;
  /** Optional code snippet surrounding the finding. */
  snippet?: string;
}

/**
 * Severity levels ordered from least to most severe.
 */
export type Severity = "info" | "low" | "medium" | "high" | "critical";

/**
 * The source tool that produced a finding.
 */
export interface FindingSource {
  /** Tool name (e.g. "eslint", "semgrep", "sonarcloud"). */
  tool: string;
  /** Tool version if known. */
  version: string | null;
  /** Original format of the tool output. */
  format: "sarif" | "json" | "text" | "custom";
  /** Original rule ID from the tool before normalization. */
  originalRuleId: string;
  /** Original severity from the tool before normalization. */
  originalSeverity: string | null;
}

/**
 * Context passed to the normalizer.
 */
export interface NormalizeContext {
  /** Project root for resolving relative paths. */
  root: string;
  /** Prefix for constructing checkId: `{checkIdPrefix}:{ruleId}` (or just
   *  `ruleId` when prefix is empty). */
  checkIdPrefix: string;
  /** Default confidence when the tool does not provide one (default 0.5). */
  defaultConfidence: number;
}

/**
 * Input to fingerprint computation.
 */
export interface FingerprintInput {
  rule: string;
  file: string;
  startLine: number;
  endLine: number;
  checkId: string;
}
