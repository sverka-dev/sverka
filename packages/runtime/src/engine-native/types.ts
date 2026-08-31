// Type definitions for @sverka/engine-native. Spec 10 — Interfaces.

import type { RunPlan, InputValue } from "@sverka/workflow";
import type { StepDefinition } from "@sverka/workflow";
import type { CacheStore } from "./cache-store.js";

// --- Engine ---

export interface RunRequest {
  readonly plan: RunPlan;
  readonly workspace: string;
  readonly artifactDir: string;
  readonly secrets?: SecretProvider;
  readonly drivers?: readonly RuntimeDriver[];
  readonly maxConcurrent?: number;
  readonly cache?: CacheStore;
}

export interface Engine {
  run(request: RunRequest): AsyncIterable<RunEvent>;
  cancel(): Promise<void>;
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
  | { readonly type: "run-completed"; readonly runId: string; readonly status: RunStatus; readonly durationMs: number }
  | { readonly type: "diagnostic"; readonly stepId: string; readonly message: string; readonly severity: "info" | "warn" | "error" };

export type RunStatus = "success" | "failure" | "cancelled";

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
  readonly maxConcurrent?: number;
  readonly cache?: CacheStore;
}
