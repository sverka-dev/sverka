// Construct classes: Project, Pipeline, Step, ShellStep, Entry.
// Spec 01 — §9.1, §10.

import { Construct } from "constructs";
import { ConstructError } from "./errors.js";
import type {
  Expression,
  Input,
  InputLiteral,
  OutputDeclaration,
  Reference,
  Runtime,
  RunnerSpec,
  IdentitySpec,
  Rule,
  PipelineDefaults,
  ReportSpec,
  ServiceContainer,
  EnvironmentSpec,
  CacheSpec,
  ConcurrencySpec,
  Trigger,
  Condition,
  MatrixSpec,
  ContinueOnError,
  RetryPolicy,
  PipelineRule,
  IncludeRef,
  ComponentRef,
  ChildPipelineTrigger,
  DownstreamTrigger,
  ReleaseSpec,
  PagesSpec,
} from "./model.js";

function isDuplicateConstructError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("There is already a Construct");
}

function validateArtifactOutputs(
  outputs: Readonly<Record<string, OutputDeclaration>> | undefined,
  id: string,
): void {
  if (!outputs) return;
  for (const [name, decl] of Object.entries(outputs)) {
    if (decl.type === "artifact" && !decl.path) {
      throw new ConstructError(
        "INVALID_OUTPUT",
        `Artifact output '${name}' on step '${id}' must have a path`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Project — root of the construct tree (scope = undefined).
// ---------------------------------------------------------------------------

export class Project extends Construct {
  constructor(id: string) {
    // constructs.Construct accepts undefined scope at runtime for root.
    super(undefined as unknown as Construct, id);
  }
}

// ---------------------------------------------------------------------------
// Pipeline — contains Steps and Entries.
// ---------------------------------------------------------------------------

export type PermissionLevel = "read" | "write" | "none";

export interface PipelineProps {
  readonly inputs?: Readonly<Record<string, Input>>;
  readonly name?: string;
  readonly runName?: Expression;
  readonly permissions?: Readonly<Record<string, PermissionLevel>>;
  readonly defaults?: PipelineDefaults;
  readonly concurrency?: ConcurrencySpec;
  readonly rules?: readonly PipelineRule[];
  readonly includes?: readonly IncludeRef[];
}

export class Pipeline extends Construct {
  readonly inputs: ReadonlyMap<string, Input>;
  readonly name?: string;
  readonly runName?: Expression;
  readonly permissions?: Readonly<Record<string, PermissionLevel>>;
  readonly defaults?: PipelineDefaults;
  readonly concurrency?: ConcurrencySpec;
  readonly rules: ReadonlyArray<PipelineRule>;
  readonly includes: ReadonlyArray<IncludeRef>;

  constructor(scope: Project, id: string, props?: PipelineProps) {
    if (!(scope instanceof Project)) {
      throw new ConstructError(
        "INVALID_SCOPE",
        "Pipeline must be created under a Project",
      );
    }
    try {
      super(scope, id);
    } catch (err) {
      if (isDuplicateConstructError(err)) {
        throw new ConstructError("DUPLICATE_ID", `Duplicate id '${id}' in Project`, err);
      }
      throw err;
    }
    this.inputs = props?.inputs
      ? new Map(Object.entries(props.inputs))
      : new Map();
    if (props?.name !== undefined) {
      this.name = props.name;
    }
    if (props?.runName !== undefined) {
      this.runName = props.runName;
    }
    if (props?.permissions !== undefined) {
      this.permissions = props.permissions;
    }
    if (props?.defaults !== undefined) {
      this.defaults = props.defaults;
    }
    if (props?.concurrency !== undefined) {
      this.concurrency = props.concurrency;
    }
    this.rules = props?.rules ? [...props.rules] : [];
    this.includes = props?.includes ? [...props.includes] : [];
  }
}

// ---------------------------------------------------------------------------
// Step — abstract base for all step types.
// ---------------------------------------------------------------------------

export interface StepProps {
  readonly runtime?: Runtime;
  readonly outputs?: Readonly<Record<string, OutputDeclaration>>;
  readonly inputs?: readonly Reference[];
  readonly dependsOn?: readonly string[];
  readonly timeout?: number;
  readonly condition?: Condition;
  readonly matrix?: MatrixSpec;
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
}

export abstract class Step extends Construct {
  readonly runtime: Runtime;
  readonly outputs: ReadonlyMap<string, OutputDeclaration>;
  readonly inputs: ReadonlyArray<Reference>;
  readonly dependsOn: ReadonlyArray<string>;
  readonly timeout?: number;
  readonly condition?: Condition;
  readonly matrix?: MatrixSpec;
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

  constructor(scope: Pipeline, id: string, props: StepProps) {
    if (!(scope instanceof Pipeline)) {
      throw new ConstructError(
        "INVALID_SCOPE",
        "Step must be created under a Pipeline",
      );
    }
    validateArtifactOutputs(props.outputs, id);
    try {
      super(scope, id);
    } catch (err) {
      if (isDuplicateConstructError(err)) {
        throw new ConstructError("DUPLICATE_ID", `Duplicate id '${id}' in Pipeline`, err);
      }
      throw err;
    }
    this.runtime = props.runtime ?? {};
    this.outputs = props.outputs
      ? new Map(Object.entries(props.outputs))
      : new Map();
    this.inputs = props.inputs ? [...props.inputs] : [];
    this.dependsOn = props.dependsOn ? [...props.dependsOn] : [];
    if (props.delay !== undefined) {
      this.delay = props.delay;
    }
    if (props.timeout !== undefined) {
      this.timeout = props.timeout;
    }
    if (props.condition !== undefined) {
      this.condition = props.condition;
    }
    if (props.matrix !== undefined) {
      this.matrix = props.matrix;
    }
    if (props.beforeScript !== undefined) {
      this.beforeScript = [...props.beforeScript];
    }
    if (props.afterScript !== undefined) {
      this.afterScript = [...props.afterScript];
    }
    if (props.continueOnError !== undefined) {
      this.continueOnError = props.continueOnError;
    }
    if (props.retry !== undefined) {
      this.retry = props.retry;
    }
    if (props.interruptible !== undefined) {
      this.interruptible = props.interruptible;
    }
    if (props.runner !== undefined) {
      this.runner = props.runner;
    }
    if (props.identity !== undefined) {
      this.identity = props.identity;
    }
    if (props.rules !== undefined) {
      this.rules = props.rules;
    }
    if (props.reports !== undefined) {
      this.reports = props.reports;
    }
    if (props.services !== undefined) {
      this.services = props.services;
    }
    if (props.environment !== undefined) {
      this.environment = props.environment;
    }
    if (props.cache !== undefined) {
      this.cache = props.cache;
    }
    if (props.concurrency !== undefined) {
      this.concurrency = props.concurrency;
    }
  }
}

// ---------------------------------------------------------------------------
// ShellStep — concrete shell-command step (§9.1, §15).
// ---------------------------------------------------------------------------

export interface ShellStepProps extends StepProps {
  readonly command: string;
  readonly background?: boolean;
}

export class ShellStep extends Step {
  readonly command: string;
  readonly background: boolean;

  constructor(scope: Pipeline, id: string, props: ShellStepProps) {
    super(scope, id, props);
    this.command = props.command;
    this.background = props.background ?? false;
  }
}

// ---------------------------------------------------------------------------
// PipelineCallStep — invokes a callee pipeline as a step (F-31).
// ---------------------------------------------------------------------------

export interface PipelineCallStepProps extends StepProps {
  readonly callee: string;
  readonly callInputs?: Readonly<Record<string, Reference | InputLiteral>>;
}

export class PipelineCallStep extends Step {
  readonly callee: string;
  readonly callInputs: ReadonlyMap<string, Reference | InputLiteral>;

  constructor(scope: Pipeline, id: string, props: PipelineCallStepProps) {
    super(scope, id, props);
    this.callee = props.callee;
    this.callInputs = props.callInputs
      ? new Map(Object.entries(props.callInputs))
      : new Map();
  }
}

// ---------------------------------------------------------------------------
// ComponentStep — invokes a versioned component as a step (F-32).
// ---------------------------------------------------------------------------

export interface ComponentStepProps extends StepProps {
  readonly component: ComponentRef;
}

export class ComponentStep extends Step {
  readonly component: ComponentRef;

  constructor(scope: Pipeline, id: string, props: ComponentStepProps) {
    super(scope, id, props);
    this.component = props.component;
  }
}

// ---------------------------------------------------------------------------
// ChildPipelineStep — triggers a dynamic child pipeline (F-33).
// ---------------------------------------------------------------------------

export interface ChildPipelineStepProps extends StepProps {
  readonly childPipeline: ChildPipelineTrigger;
}

export class ChildPipelineStep extends Step {
  readonly childPipeline: ChildPipelineTrigger;

  constructor(scope: Pipeline, id: string, props: ChildPipelineStepProps) {
    super(scope, id, props);
    this.childPipeline = props.childPipeline;
  }
}

// ---------------------------------------------------------------------------
// DownstreamStep — triggers a pipeline in another project (F-34).
// ---------------------------------------------------------------------------

export interface DownstreamStepProps extends StepProps {
  readonly downstream: DownstreamTrigger;
}

export class DownstreamStep extends Step {
  readonly downstream: DownstreamTrigger;

  constructor(scope: Pipeline, id: string, props: DownstreamStepProps) {
    super(scope, id, props);
    this.downstream = props.downstream;
  }
}

// ---------------------------------------------------------------------------
// ReleaseStep — creates a versioned release (F-39).
// ---------------------------------------------------------------------------

export interface ReleaseStepProps extends StepProps {
  readonly release: ReleaseSpec;
}

export class ReleaseStep extends Step {
  readonly release: ReleaseSpec;

  constructor(scope: Pipeline, id: string, props: ReleaseStepProps) {
    super(scope, id, props);
    this.release = props.release;
  }
}

// ---------------------------------------------------------------------------
// PagesStep — deploys static content to Pages (F-40).
// ---------------------------------------------------------------------------

export interface PagesStepProps extends StepProps {
  readonly pages: PagesSpec;
}

export class PagesStep extends Step {
  readonly pages: PagesSpec;

  constructor(scope: Pipeline, id: string, props: PagesStepProps) {
    super(scope, id, props);
    this.pages = props.pages;
  }
}

// ---------------------------------------------------------------------------
// Entry — binds a Trigger to root Steps (§13).
// ---------------------------------------------------------------------------

export interface EntryProps {
  readonly trigger: Trigger;
  readonly roots: readonly string[];
}

export class Entry extends Construct {
  readonly trigger: Trigger;
  readonly roots: ReadonlyArray<string>;

  constructor(scope: Pipeline, id: string, props: EntryProps) {
    if (!(scope instanceof Pipeline)) {
      throw new ConstructError(
        "INVALID_SCOPE",
        "Entry must be created under a Pipeline",
      );
    }
    try {
      super(scope, id);
    } catch (err) {
      if (isDuplicateConstructError(err)) {
        throw new ConstructError("DUPLICATE_ID", `Duplicate id '${id}' in Pipeline`, err);
      }
      throw err;
    }
    this.trigger = props.trigger;
    this.roots = [...props.roots];
  }
}
