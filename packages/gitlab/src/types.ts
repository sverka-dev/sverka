// GitLab target types. Spec 09 — §18.2, §19.

import type { CapabilitySupport } from "@sverka/plugin";

export interface GitlabRule {
  readonly if?: string;
  readonly when?: string;
  readonly changes?: readonly string[];
  readonly exists?: readonly string[];
  readonly variables?: Readonly<Record<string, string>>;
}

export interface GitlabArtifactSpec {
  readonly paths?: readonly string[];
  readonly reports?: Readonly<Record<string, unknown>>;
  readonly expireIn?: string;
  readonly access?: string;
}

export interface GitlabService {
  readonly name: string;
  readonly alias?: string;
  readonly entrypoint?: readonly string[];
  readonly command?: readonly string[];
  readonly variables?: Record<string, string>;
}

export interface GitlabEnvironment {
  readonly name: string;
  readonly url?: string;
  readonly action?: string;
  readonly deploymentTier?: string;
  readonly onStop?: string;
}

export interface GitlabJob {
  readonly id: string;
  readonly stage: string;
  readonly image?: string;
  readonly needs: readonly string[];
  readonly script: readonly string[];
  readonly beforeScript?: readonly string[];
  readonly afterScript?: readonly string[];
  readonly artifacts?: GitlabArtifactSpec;
  readonly variables?: Record<string, string>;
  readonly rules?: readonly GitlabRule[];
  readonly timeout?: string;
  readonly allowFailure?: boolean | { readonly exitCodes: readonly number[] };
  readonly retry?: {
    readonly max: number;
    readonly when?: readonly string[];
    readonly exitCodes?: readonly number[];
  };
  readonly parallel?: {
    readonly matrix: readonly Record<string, unknown>[];
  };
  readonly interruptible?: boolean;
  readonly tags?: readonly string[];
  readonly idTokens?: Readonly<Record<string, { aud: string }>>;
  readonly services?: readonly GitlabService[];
  readonly environment?: GitlabEnvironment;
  readonly cache?: GitlabCache;
  readonly resourceGroup?: string;
  readonly trigger?: GitlabTrigger;
  readonly release?: GitlabRelease;
  readonly pages?: GitlabPages;
  readonly when?: "on_success" | "on_failure" | "always" | "manual" | "delayed" | "never";
  readonly start_in?: string;
}

export interface GitlabCache {
  readonly paths: readonly string[];
  readonly key: string;
  readonly policy?: string;
  readonly fallbackKeys?: readonly string[];
}

export interface GitlabDefault {
  readonly image?: string;
  readonly beforeScript?: readonly string[];
  readonly afterScript?: readonly string[];
  readonly timeout?: string;
  readonly retry?: { max: number; exitCodes?: readonly number[] };
  readonly interruptible?: boolean;
}

export interface GitlabSpecInput {
  readonly type: string;
  readonly description?: string;
  readonly default?: string | number | boolean | readonly string[];
  readonly options?: readonly string[];
  readonly regex?: string;
}

export interface GitlabPages {
  readonly publish: string;
  readonly path_prefix?: string;
}

export interface GitlabRelease {
  readonly tag_name: string;
  readonly name?: string;
  readonly description?: string;
  readonly assets?: { readonly links: readonly { readonly name: string; readonly url: string }[] };
  readonly draft?: boolean;
}

export interface GitlabTrigger {
  readonly include?: readonly GitlabTriggerInclude[];
  readonly project?: string;
  readonly branch?: string;
  readonly strategy?: string;
}

export interface GitlabTriggerInclude {
  readonly artifact: string;
  readonly job: string;
}

export interface GitlabComponentInclude {
  readonly component: string;
  readonly inputs: Record<string, unknown>;
}

export interface GitlabLocalInclude {
  readonly local: string;
  readonly inputs?: Record<string, unknown>;
}

export interface GitlabWorkflowRule {
  readonly if?: string;
  readonly changes?: readonly string[];
  readonly exists?: readonly string[];
  readonly variables?: Record<string, string>;
  readonly when?: "always" | "never";
}

export interface GitlabTargetGraph {
  readonly name: string;
  readonly stages: readonly string[];
  readonly jobs: readonly GitlabJob[];
  readonly variables: Record<string, string>;
  readonly autoCancel?: boolean;
  readonly default?: GitlabDefault;
  readonly specInputs?: Readonly<Record<string, GitlabSpecInput>>;
  readonly includes: readonly GitlabComponentInclude[];
  readonly localIncludes?: readonly GitlabLocalInclude[];
  readonly workflowRules?: readonly GitlabWorkflowRule[];
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
