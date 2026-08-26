// GitHub target types. Spec 08 — §18.1, §19.

import type { CapabilitySupport } from "@sverka/plugin";

export interface GithubInput {
  readonly type: string;
  readonly description?: string;
  readonly required?: boolean;
  readonly default?: string | number | boolean;
  readonly options?: readonly string[];
}

export interface GithubTriggers {
  readonly push?: {
    readonly branches?: readonly string[];
    readonly tags?: readonly string[];
    readonly paths?: readonly string[];
  };
  readonly pull_request?: {
    readonly branches?: readonly string[];
    readonly paths?: readonly string[];
  };
  readonly workflow_dispatch?: null | { readonly inputs?: Readonly<Record<string, GithubInput>> };
  readonly schedule?: readonly {
    readonly cron: string;
    readonly timezone?: string;
  }[];
  readonly workflow_call?: {
    readonly inputs?: Record<string, unknown>;
  } | null;
}

export interface GithubStep {
  readonly id?: string;
  readonly name?: string;
  readonly run?: string;
  readonly uses?: string;
  readonly with?: Record<string, unknown>;
  readonly env?: Record<string, string>;
  readonly if?: string;
  readonly continueOnError?: boolean;
  readonly workingDirectory?: string;
  readonly shell?: string;
}

export type GithubRunsOn = string | readonly string[] | {
  readonly group: string;
  readonly labels: readonly string[];
};

export interface GithubService {
  readonly image: string;
  readonly env?: Record<string, string>;
  readonly ports?: readonly string[];
  readonly options?: string;
}

export interface GithubJob {
  readonly id: string;
  readonly name: string;
  readonly runsOn: GithubRunsOn;
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
  readonly outputs?: Record<string, string>;
  readonly if?: string;
  readonly permissions?: Readonly<Record<string, string>>;
  readonly services?: Readonly<Record<string, GithubService>>;
  readonly environment?: { readonly name: string; readonly url?: string };
  readonly cache?: GithubCache;
  readonly concurrency?: { readonly group: string; readonly cancelInProgress?: boolean };
  /** For reusable workflow call jobs: "uses" + "with" + "secrets". */
  readonly uses?: string;
  readonly with?: Record<string, unknown>;
  readonly secrets?: "inherit" | Record<string, string>;
}

export interface GithubCache {
  readonly path: readonly string[];
  readonly key: string;
  readonly restoreKeys?: readonly string[];
}

export interface GithubDefaultsRun {
  readonly shell?: string;
  readonly "working-directory"?: string;
}

export interface GithubDefaults {
  readonly run: GithubDefaultsRun;
}

export interface GithubTargetGraph {
  readonly name: string;
  readonly runName?: string;
  readonly on: GithubTriggers;
  readonly jobs: readonly GithubJob[];
  readonly env: Record<string, string>;
  readonly permissions?: Readonly<Record<string, string>>;
  readonly defaults?: GithubDefaults;
  readonly concurrency?: { readonly group: string; readonly cancelInProgress?: boolean };
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
