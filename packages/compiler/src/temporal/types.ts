// Temporal target types. Spec 33 — §19.

import type { CapabilitySupport } from "../plugin/index.js";
import type { Condition } from "@sverka/workflow";

/**
 * Optional {@link TemporalTarget} constructor config.
 */
export interface TemporalTargetConfig {
  /** Temporal namespace; default "default". */
  readonly namespace?: string;
  /** Task queue name; default "sverka". */
  readonly taskQueue?: string;
}

/** A lowered Temporal activity (one per step). */
export interface TemporalActivity {
  readonly stepId: string;
  readonly commands: readonly string[];
  /** Background shell commands — emitted as detached spawns, not awaited. */
  readonly backgroundCommands?: readonly string[];
  readonly retry?: { readonly max: number };
  readonly timeoutMs?: number;
  readonly condition?: Condition;
  /** Runtime environment variables to apply to the generated activity. */
  readonly env?: Readonly<Record<string, string>>;
  /** Working directory to apply to the generated activity (cwd option). */
  readonly workingDir?: string;
  /** Custom shell to use when invoking commands (default "sh"). */
  readonly shell?: string;
  /** Names of secrets referenced by the step (values are not embedded). */
  readonly secrets?: readonly string[];
  /** Lowering warnings surfaced as comments in generated code. */
  readonly warnings?: readonly string[];
}

/** A lowered Temporal workflow entry. */
export interface TemporalWorkflow {
  readonly entryId: string;
  readonly triggerKind: "manual" | "schedule" | "push" | "changeRequest";
  readonly cron?: string;
  readonly activities: readonly TemporalActivity[];
  /** Ordered activity step IDs for sequential execution. */
  readonly sequence: readonly string[];
}

/** Lowered Temporal target graph. */
export interface TemporalTargetGraph {
  readonly name: string;
  readonly namespace: string;
  readonly taskQueue: string;
  readonly workflows: readonly TemporalWorkflow[];
}

export interface GeneratedArtifact {
  readonly path: string;
  readonly content: string;
}

export interface TargetDiagnostic {
  readonly capability: string;
  readonly support: CapabilitySupport;
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly stepId?: string;
}

export interface CompilationResult {
  readonly artifacts: readonly GeneratedArtifact[];
  readonly diagnostics: readonly TargetDiagnostic[];
}
