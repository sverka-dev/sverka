// Definition Graph types — the canonical provider-neutral source of truth.
// Spec 02 — §10, §11, §15.

import type {
  Reference,
  Trigger,
  Runtime,
  Input,
  OutputDeclaration,
  OutputType,
} from "@sverka/constructs";

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

export interface PipelineDefinition {
  readonly id: string;
  readonly inputs: readonly Input[];
  readonly entries: readonly EntryDefinition[];
  readonly steps: readonly StepDefinition[];
  readonly outputs: readonly PipelineOutputDefinition[];
}

export interface EntryDefinition {
  readonly id: string;
  readonly trigger: Trigger;
  readonly roots: readonly string[]; // StepDefinition ids
}

export interface StepDefinition {
  readonly id: string;
  readonly runtime: Runtime;
  readonly operations: readonly OperationDefinition[];
  readonly inputs: readonly Reference[];
  readonly outputs: readonly OutputDefinition[];
  readonly dependencies: readonly Dependency[];
  readonly timeout?: number;
  readonly condition?: Reference;
}

export type OperationDefinition =
  | { readonly kind: "shell"; readonly command: string }
  | { readonly kind: "exportOutput"; readonly name: string; readonly type: OutputType }
  | { readonly kind: "exportArtifact"; readonly name: string; readonly path: string }
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
    };

export type Dependency =
  | { readonly kind: "control"; readonly producer: string }
  | { readonly kind: "value"; readonly producer: string; readonly output: string }
  | { readonly kind: "artifact"; readonly producer: string; readonly output: string };
