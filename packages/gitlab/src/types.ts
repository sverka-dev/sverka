// GitLab target types. Spec 09 — §18.2, §19.

import type { CapabilitySupport } from "@sverka/plugin";

export interface GitlabRule {
  readonly if: string;
  readonly when?: string;
}

export interface GitlabArtifactSpec {
  readonly paths?: readonly string[];
  readonly reports?: {
    readonly dotenv?: string;
  };
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
}

export interface GitlabTargetGraph {
  readonly name: string;
  readonly stages: readonly string[];
  readonly jobs: readonly GitlabJob[];
  readonly variables: Record<string, string>;
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
