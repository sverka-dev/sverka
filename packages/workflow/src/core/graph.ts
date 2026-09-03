// Definition Graph types — the canonical provider-neutral source of truth.
// Spec 02 — §10, §11, §15.

import type { Reference, Trigger, Runtime, NetworkAllowlist, Input, InputLiteral, ComponentRef, ChildPipelineTrigger, DownstreamTrigger, PipelineRule, IncludeRef, OutputDeclaration, OutputType, ArtifactAccess, MatrixSpec, Condition, ContinueOnError, RetryPolicy, BackoffSpec, PermissionLevel, RunnerSpec, IdentitySpec, Rule, PipelineDefaults, ReportSpec, ServiceContainer, EnvironmentSpec, CacheSpec, ConcurrencySpec, StepPermissions, WriteDeclaration, AgentToolRef, AgentOperation } from "../cdk/index.js";

// Re-export types used in the graph schema so consumers can access them
// from @sverka/core without depending on @sverka/cdk directly.
export type { Input, InputLiteral, ComponentRef, ChildPipelineTrigger, DownstreamTrigger, PipelineRule, IncludeRef, OutputDeclaration, OutputType, Reference, Expression, Runtime, NetworkAllowlist, Trigger, MatrixSpec, MatrixValue, Condition, ContinueOnError, RetryPolicy, BackoffSpec, PermissionLevel, RunnerSpec, IdentitySpec, Rule, PipelineDefaults, ReportSpec, ServiceContainer, EnvironmentSpec, EnvironmentAction, EnvironmentTier, ArtifactAccess, CacheSpec, CachePolicy, ConcurrencySpec, StepPermissions, WriteDeclaration, AgentToolRef, AgentOperation } from "../cdk/index.js";

export interface DefinitionGraph {
  readonly project: ProjectDefinition;
}

export interface ProjectDefinition {
  readonly id: string;
  readonly pipelines: readonly PipelineDefinition[];
}

export interface OutputDefinition extends OutputDeclaration {
  readonly name: string;
}

export interface PipelineOutputDefinition extends OutputDefinition {
  readonly stepId: string;
}

export interface PipelineInputDefinition extends Input {
  readonly name: string;
}

export interface PipelineDefinition {
  readonly id: string;
  readonly inputs: Readonly<Record<string, Input>>;
  readonly entries: readonly EntryDefinition[];
  readonly steps: readonly StepDefinition[];
  readonly outputs: readonly PipelineOutputDefinition[];
  readonly permissions?: Readonly<Record<string, PermissionLevel>>;
  readonly defaults?: PipelineDefaults;
  readonly concurrency?: ConcurrencySpec;
  readonly rules?: readonly PipelineRule[];
  readonly includes?: readonly IncludeRef[];
}

export interface EntryDefinition {
  readonly id: string;
  readonly trigger: Trigger;
  readonly roots: readonly string[]; // StepDefinition ids
}

export interface PipelineCall {
  readonly callee: string;
  readonly inputs: Readonly<Record<string, Reference | InputLiteral>>;
}

export interface StepDefinition {
  readonly id: string;
  readonly runtime: Runtime;
  readonly operations: readonly OperationDefinition[];
  readonly inputs: readonly Reference[];
  readonly outputs: readonly OutputDefinition[];
  readonly dependencies: readonly Dependency[];
  readonly timeout?: number;
  readonly condition?: Condition;
  readonly matrix?: MatrixSpec;
  readonly matrixValues?: Readonly<Record<string, string | number>>;
  readonly matrixFailFast?: boolean;
  readonly matrixMaxParallel?: number;
  readonly beforeScript?: readonly string[];
  readonly afterScript?: readonly string[];
  readonly continueOnError?: ContinueOnError;
  readonly retry?: RetryPolicy;
  readonly interruptible?: boolean;
  readonly runner?: RunnerSpec;
  readonly identity?: IdentitySpec;
  readonly rules?: readonly Rule[];
  readonly reports?: readonly ReportSpec[];
  readonly services?: readonly ServiceContainer[];
  readonly environment?: EnvironmentSpec;
  readonly cache?: CacheSpec;
  readonly concurrency?: ConcurrencySpec;
  readonly delay?: string;
  readonly call?: PipelineCall;
  readonly component?: ComponentRef;
  readonly childPipeline?: ChildPipelineTrigger;
  readonly downstream?: DownstreamTrigger;
  readonly permissions?: StepPermissions;
  readonly compensation?: OperationDefinition;
}

export type OperationDefinition =
  | { readonly kind: "shell"; readonly command: string; readonly background?: boolean }
  | { readonly kind: "exportOutput"; readonly name: string; readonly type: OutputType }
  | { readonly kind: "exportArtifact"; readonly name: string; readonly path: string; readonly retention?: string; readonly access?: ArtifactAccess }
  | {
      readonly kind: "importArtifact";
      readonly name: string;
      readonly from: string;
      readonly output: string;
    }
  | {
      readonly kind: "diagnostic";
      readonly message: string;
      readonly severity: "info" | "warn" | "error";
    }
  | {
      readonly kind: "report";
      readonly spec: ReportSpec;
    }
  | {
      readonly kind: "release";
      readonly tag: string;
      readonly name?: string;
      readonly description?: string;
      readonly assets?: readonly string[];
      readonly draft?: boolean;
      readonly prerelease?: boolean;
    }
  | {
      readonly kind: "deployPages";
      readonly path: string;
      readonly prefix?: string;
    }
  | AgentOperation;

export type Dependency =
  | { readonly kind: "control"; readonly producer: string }
  | { readonly kind: "value"; readonly producer: string; readonly output: string }
  | { readonly kind: "artifact"; readonly producer: string; readonly output: string };
