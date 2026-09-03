// Inngest target types. Spec 35 — §19.

import type { CapabilitySupport } from "../plugin/index.js";
import type { MatrixValue, Condition } from "@sverka/workflow";

/**
 * Optional {@link InngestTarget} constructor config.
 */
export interface InngestTargetConfig {
  /** App ID; defaults to pipeline ID. */
  readonly appId?: string;
}

/** A lowered Inngest step (one step.run call). */
export interface InngestStep {
  readonly stepId: string;
  readonly commands: readonly string[];
  readonly dependsOn: readonly string[];
  readonly timeout?: number;
  readonly retry?: { readonly max: number };
  readonly condition?: Condition;
  readonly matrix?: { readonly dimensions: Readonly<Record<string, readonly MatrixValue[]>> };
  readonly hasScalarOutput: boolean;
  readonly hasArtifactOutput: boolean;
}

/** A lowered Inngest function (one per entry). */
export interface InngestFunction {
  readonly entryId: string;
  readonly triggerKind: "manual" | "schedule" | "push" | "changeRequest";
  readonly cron?: string;
  readonly steps: readonly InngestStep[];
  /** Topologically ordered step IDs. */
  readonly sequence: readonly string[];
}

/** Lowered Inngest target graph. */
export interface InngestTargetGraph {
  readonly appId: string;
  readonly functions: readonly InngestFunction[];
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
