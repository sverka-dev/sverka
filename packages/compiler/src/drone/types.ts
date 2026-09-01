// Drone target types. Spec 36 — §19.

import type { CapabilitySupport } from "../plugin/index.js";

/**
 * Optional {@link DroneTarget} constructor config.
 */
export interface DroneTargetConfig {
  /** Pipeline type: "docker" (default) or "kubernetes". */
  readonly type?: "docker" | "kubernetes";
  /** Default image for steps without an explicit container runtime. */
  readonly image?: string;
}

/** A single Drone pipeline step. */
export interface DroneStep {
  readonly name: string;
  readonly image: string;
  readonly commands: readonly string[];
  readonly dependsOn: readonly string[];
}

/** A Drone trigger block. */
export interface DroneTrigger {
  readonly branch?: readonly string[];
  readonly event?: readonly string[];
  readonly cron?: readonly string[];
}

/** Lowered Drone pipeline graph. */
export interface DroneTargetGraph {
  readonly name: string;
  readonly type: "docker" | "kubernetes";
  readonly steps: readonly DroneStep[];
  readonly trigger: DroneTrigger;
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
