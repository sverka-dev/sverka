// Dagger target types. Spec 34 — §19.

import type { CapabilitySupport } from "../plugin/index.js";
import type { Runtime, Condition, MatrixSpec } from "@sverka/workflow";

/**
 * Optional {@link DaggerTarget} constructor config.
 */
export interface DaggerTargetConfig {
  /** Module name (default: pipeline id). */
  readonly moduleName?: string;
}

/** A lowered Dagger step (one withExec call). */
export interface DaggerStep {
  readonly stepId: string;
  readonly name: string;
  readonly commands: readonly string[];
  readonly dependsOn: readonly string[];
  readonly runtime: Runtime;
  readonly condition?: Condition;
  readonly matrix?: MatrixSpec;
  readonly retry?: { readonly max: number };
  readonly timeout?: number; // ms
}

/** Lowered Dagger target graph. */
export interface DaggerTargetGraph {
  readonly moduleName: string;
  readonly entryId: string;
  readonly steps: readonly DaggerStep[];
  /** Ordered step IDs reflecting DAG topology. */
  readonly sequence: readonly string[];
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
