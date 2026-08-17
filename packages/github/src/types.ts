// GitHub target types. Spec 08 — §18.1, §19.

import type { CapabilitySupport } from "@sverka/plugin";

export interface GithubTriggers {
  readonly push?: { readonly branches?: readonly string[] };
  readonly pull_request?: { readonly branches?: readonly string[] };
  readonly workflow_dispatch?: null;
}

export interface GithubStep {
  readonly id?: string;
  readonly name?: string;
  readonly run?: string;
  readonly uses?: string;
  readonly with?: Record<string, unknown>;
  readonly env?: Record<string, string>;
}

export interface GithubJob {
  readonly id: string;
  readonly name: string;
  readonly runsOn: string;
  readonly needs: readonly string[];
  readonly steps: readonly GithubStep[];
  readonly timeoutMinutes?: number;
  readonly env?: Record<string, string>;
  readonly container?: string;
  readonly strategy?: {
    readonly matrix: Record<string, unknown>;
    readonly failFast?: boolean;
    readonly maxParallel?: number;
  };
}

export interface GithubTargetGraph {
  readonly name: string;
  readonly on: GithubTriggers;
  readonly jobs: readonly GithubJob[];
  readonly env: Record<string, string>;
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
