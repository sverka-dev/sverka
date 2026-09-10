// @sverka/playground — types. Browser-safe, no Node.js imports.

/** Severity levels ordered from least to most severe. */
export type Severity = "info" | "low" | "medium" | "high" | "critical";

/** Source tool that produced a finding. */
export interface FindingSource {
  tool: string;
  version: string | null;
  format: "sarif" | "json" | "text" | "custom";
  originalRuleId: string;
  originalSeverity: string | null;
}

/** A normalized finding — structurally compatible with @sverka/verification Finding. */
export interface Finding {
  id: string;
  fingerprint: string;
  checkId: string;
  severity: Severity;
  confidence: number;
  message: string;
  rule: string;
  file: string;
  startLine: number;
  endLine: number;
  startColumn?: number;
  endColumn?: number;
  helpUrl?: string;
  source: FindingSource;
  snippet?: string;
}

/** Simplified finding that FunctionStep functions return. The runner
 *  fills in fingerprint, id, and source defaults. */
export interface PlaygroundFinding {
  rule: string;
  file: string;
  line: number;
  severity: Severity;
  message: string;
  tool?: string;
  snippet?: string;
}

/** Result of running a single step. */
export interface StepResult {
  stepId: string;
  status: "success" | "failure";
  findings: Finding[];
  durationMs: number;
  error?: string;
}

/** Result of running a full pipeline. */
export interface PipelineResult {
  steps: StepResult[];
  findings: Finding[];
  totalDurationMs: number;
  success: boolean;
}
