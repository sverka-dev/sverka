// @sverka/reporter — public types. Spec 43.

import type { RunEvent, RunStatus } from "@sverka/runtime";
import type { Finding, Policy, PolicyResult } from "@sverka/verification";

/** A renderer consumes run events, findings, and a policy verdict. */
export interface Renderer {
  /** Called for each RunEvent as the engine produces it. */
  onEvent(event: RunEvent): void;
  /** Called after the run completes with collected findings (if --evaluate). */
  onFindings(findings: readonly Finding[]): void;
  /** Called after policy evaluation with the verdict (if --evaluate). */
  onVerdict(result: PolicyResult): void;
  /** Called once after all output is done. Flush buffers, close handles. */
  flush(): void;
}

/** Accumulated state from a RunEvent stream. */
export interface UIState {
  readonly runId: string | null;
  readonly planId: string | null;
  readonly status: RunStatus | null;
  readonly durationMs: number | null;
  readonly steps: ReadonlyMap<string, StepUIState>;
  readonly diagnostics: readonly DiagnosticEntry[];
}

export interface StepUIState {
  readonly stepId: string;
  readonly state: StepState;
  readonly durationMs?: number;
  readonly error?: string;
  readonly attempt?: number;
}

export type StepState =
  | "pending"
  | "ready"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | "cancelled"
  | "cache-hit"
  | "suspended"
  | "compensating"
  | "compensated";

export interface DiagnosticEntry {
  readonly stepId: string;
  readonly message: string;
  readonly severity: "info" | "warn" | "error";
}

/** A finding attributed to the step that produced it. */
export interface FindingRow {
  readonly finding: Finding;
  readonly stepId: string;
}

/** Options for collecting findings from the artifact directory. */
export interface FindingsCollectorOptions {
  readonly artifactDir: string;
}

/** Options for evaluating the policy gate. */
export interface PolicyGateOptions {
  readonly findings: readonly Finding[];
  readonly policy?: Policy;
  readonly baselineFingerprints?: readonly string[];
}

/** Result of policy gate evaluation. */
export interface PolicyGateResult {
  readonly result: PolicyResult;
  readonly exitCode: number;
}

/** Options for creating a text renderer. */
export interface TextRendererOptions {
  readonly writer: TextWriter;
}

/** Minimal write interface for the text renderer (subset of OutputWriter). */
export interface TextWriter {
  writeLine(text: string): void;
}
