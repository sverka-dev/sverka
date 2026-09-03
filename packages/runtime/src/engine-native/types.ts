// Type definitions for @sverka/engine-native. Spec 10 — Interfaces.
// Spec 29 — Suspend/Resume snapshot types.
// Spec 32 — Run Queries (RunState).

import type { RunPlan, InputValue, NetworkAllowlist } from "@sverka/workflow";
import type { StepDefinition } from "@sverka/workflow";
import type { CacheStore } from "./cache-store.js";
import type { AgentDriver } from "./agent-driver.js";
import type { StepState } from "./scheduler.js";

// --- Resume schema (Spec 29) ---

export interface ResumeSchema {
  readonly required?: readonly string[];
}

// --- Run snapshot (Spec 29) ---

export interface RunSnapshot {
  readonly runId: string;
  readonly planId: string;
  readonly plan: RunPlan;
  readonly completedSteps: readonly {
    readonly stepId: string;
    readonly outputs: Readonly<Record<string, InputValue>>;
  }[];
  readonly suspendedStepId: string;
  readonly resumeSchema?: ResumeSchema;
  readonly suspendedAt: number;
  readonly status: "suspended";
}

export interface SnapshotStore {
  save(snapshot: RunSnapshot): Promise<void>;
  load(runId: string): Promise<RunSnapshot | undefined>;
  delete(runId: string): Promise<void>;
}

// --- Engine ---

export interface RunRequest {
  readonly plan: RunPlan;
  readonly workspace: string;
  readonly artifactDir: string;
  readonly secrets?: SecretProvider;
  readonly drivers?: readonly RuntimeDriver[];
  readonly agentDrivers?: readonly AgentDriver[];
  readonly maxConcurrent?: number;
  readonly cache?: CacheStore;
  readonly snapshotStore?: SnapshotStore;
}

// --- Run query (Spec 32) ---

export interface RunState {
  readonly runId: string;
  readonly planId: string;
  readonly status: "running" | RunStatus;
  readonly startedAt: number;
  readonly steps: readonly {
    readonly stepId: string;
    readonly state: StepState;
    readonly durationMs?: number;
  }[];
}

export interface Engine {
  run(request: RunRequest): AsyncIterable<RunEvent>;
  resume(request: ResumeRequest): AsyncIterable<RunEvent>;
  cancel(): Promise<void>;
  query(runId?: string): RunState | undefined;
}

export interface ResumeRequest {
  readonly runId: string;
  readonly data: string;
  readonly snapshotStore: SnapshotStore;
  readonly workspace: string;
  readonly artifactDir: string;
  readonly secrets?: SecretProvider;
  readonly drivers?: readonly RuntimeDriver[];
  readonly agentDrivers?: readonly AgentDriver[];
  readonly maxConcurrent?: number;
  readonly cache?: CacheStore;
}

// --- Run events (§22.2 step states) ---

export type RunEvent =
  | { readonly type: "run-started"; readonly runId: string; readonly planId: string }
  | { readonly type: "step-pending"; readonly stepId: string }
  | { readonly type: "step-ready"; readonly stepId: string }
  | { readonly type: "step-started"; readonly stepId: string }
  | { readonly type: "step-succeeded"; readonly stepId: string; readonly durationMs: number }
  | { readonly type: "step-failed"; readonly stepId: string; readonly error: string; readonly durationMs: number }
  | { readonly type: "step-skipped"; readonly stepId: string }
  | { readonly type: "step-cancelled"; readonly stepId: string }
  | { readonly type: "step-cache-hit"; readonly stepId: string; readonly key: string }
  | { readonly type: "step-retry"; readonly stepId: string; readonly attempt: number; readonly nextAttemptMs: number }
  | { readonly type: "step-suspended"; readonly stepId: string; readonly resumeSchema?: ResumeSchema }
  | { readonly type: "run-suspended"; readonly runId: string; readonly suspendedStepId: string; readonly durationMs: number }
  | { readonly type: "run-resumed"; readonly runId: string; readonly planId: string }
  | { readonly type: "run-completed"; readonly runId: string; readonly status: RunStatus; readonly durationMs: number }
  | { readonly type: "diagnostic"; readonly stepId: string; readonly message: string; readonly severity: "info" | "warn" | "error" };

export type RunStatus = "success" | "failure" | "cancelled" | "suspended";

// --- Runtime driver ---

export interface RuntimeDriver {
  readonly name: string;
  canExecute(step: StepDefinition): boolean;
  executeShell(request: ShellExecuteRequest): Promise<ShellResult>;
  dispose?(): Promise<void>;
}

export interface ShellExecuteRequest {
  readonly command: string;
  readonly workspace: string;
  readonly env: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly image?: string;
  readonly imageDigest?: string;
  readonly mode?: "host" | "container";
  readonly shell?: string;
  readonly network?: NetworkAllowlist;
  readonly signal?: AbortSignal;
}

export interface ShellResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
}

// --- Value store ---

export interface ValueStore {
  set(stepId: string, outputName: string, value: InputValue): void;
  get(stepId: string, outputName: string): InputValue | undefined;
}

// --- Artifact store ---

export interface ArtifactStore {
  store(stepId: string, outputName: string, sourcePath: string): Promise<string>;
  retrieve(stepId: string, outputName: string, destPath: string): Promise<string>;
}

// --- Secret provider ---

export interface SecretProvider {
  resolve(name: string): Promise<string | undefined>;
}

// --- Engine config ---

export interface EngineConfig {
  readonly drivers: readonly RuntimeDriver[];
  readonly agentDrivers?: readonly AgentDriver[];
  readonly maxConcurrent?: number;
  readonly cache?: CacheStore;
}
