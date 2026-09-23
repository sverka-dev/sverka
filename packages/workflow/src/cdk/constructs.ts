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
  StepPermissions,
  AgentToolRef,
} from "./model.js";
import type { OperationDefinition } from "../core/graph.js";

function isDuplicateConstructError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("There is already a Construct");
}

function validateArtifactOutputs(
  outputs: Readonly<Record<string, OutputDeclaration>> | undefined,
  id: string,
): void {
  if (!outputs) return;
  for (const [name, decl] of Object.entries(outputs)) {
    if (decl.type === "artifact" && !decl.path && decl.fromStdout !== true) {
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

/**
 * Root of the construct tree. A Project contains one or more Pipelines.
 *
 * @example
 * ```ts
 * const proj = new Project("myproj");
 * const ci = new Pipeline(proj, "ci");
 * ```
 */
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

/** Props for constructing a Pipeline. */
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

const PIPELINE_PROPS: ReadonlySet<string> = new Set([
  "inputs",
  "name",
  "runName",
  "permissions",
  "defaults",
  "concurrency",
  "rules",
  "includes",
]);

/**
 * A Pipeline contains Steps and Entries. It must be created under a Project —
 * or pass just an id and a default Project is created implicitly.
 *
 * @example
 * ```ts
 * // Explicit Project (multi-pipeline project):
 * const proj = new Project("myproj");
 * const ci = new Pipeline(proj, "ci");
 *
 * // Implicit Project (single-pipeline configs):
 * const ci = new Pipeline("ci");
 * ```
 */
export class Pipeline extends Construct {
  readonly inputs: ReadonlyMap<string, Input>;
  readonly name?: string;
  readonly runName?: Expression;
  readonly permissions?: Readonly<Record<string, PermissionLevel>>;
  readonly defaults?: PipelineDefaults;
  readonly concurrency?: ConcurrencySpec;
  readonly rules: ReadonlyArray<PipelineRule>;
  readonly includes: ReadonlyArray<IncludeRef>;

  constructor(scope: Project, id: string, props?: PipelineProps);
  constructor(id: string, props?: PipelineProps);
  constructor(
    scopeOrId: Project | string,
    idOrProps?: string | PipelineProps,
    props?: PipelineProps,
  ) {
    let scope: Project;
    let id: string;
    let pipelineProps: PipelineProps | undefined;
    if (typeof scopeOrId === "string") {
      scope = new Project("default");
      id = scopeOrId;
      pipelineProps = idOrProps as PipelineProps | undefined;
    } else {
      if (!(scopeOrId instanceof Project)) {
        throw new ConstructError(
          "INVALID_SCOPE",
          "Pipeline must be created under a Project",
        );
      }
      scope = scopeOrId;
      id = idOrProps as string;
      pipelineProps = props;
    }
    try {
      super(scope, id);
    } catch (err) {
      if (isDuplicateConstructError(err)) {
        throw new ConstructError("DUPLICATE_ID", `Duplicate id '${id}' in Project`, err);
      }
      throw err;
    }
    this.inputs = pipelineProps?.inputs
      ? new Map(Object.entries(pipelineProps.inputs))
      : new Map();
    if (pipelineProps?.name !== undefined) {
      this.name = pipelineProps.name;
    }
    if (pipelineProps?.runName !== undefined) {
      this.runName = pipelineProps.runName;
    }
    if (pipelineProps?.permissions !== undefined) {
      this.permissions = pipelineProps.permissions;
    }
    if (pipelineProps?.defaults !== undefined) {
      this.defaults = pipelineProps.defaults;
    }
    if (pipelineProps?.concurrency !== undefined) {
      this.concurrency = pipelineProps.concurrency;
    }
    this.rules = pipelineProps?.rules ? [...pipelineProps.rules] : [];
    this.includes = pipelineProps?.includes ? [...pipelineProps.includes] : [];
    if (pipelineProps) {
      warnUnknownProps(this, pipelineProps, PIPELINE_PROPS);
    }
  }
}

// ---------------------------------------------------------------------------
// Step — abstract base for all step types.
// ---------------------------------------------------------------------------

export interface StepProps {
  readonly runtime?: Runtime;
  readonly outputs?: Readonly<Record<string, OutputDeclaration>>;
  readonly inputs?: readonly Reference[];
  /** Steps this step depends on, by node id. */
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
  readonly permissions?: StepPermissions;
  readonly compensation?: OperationDefinition;
}

const OPTIONAL_STEP_PROPS = [
  "delay",
  "timeout",
  "condition",
  "matrix",
  "beforeScript",
  "afterScript",
  "continueOnError",
  "retry",
  "interruptible",
  "runner",
  "identity",
  "rules",
  "reports",
  "services",
  "environment",
  "cache",
  "concurrency",
  "permissions",
  "compensation",
] as const;

const KNOWN_STEP_PROPS: ReadonlySet<string> = new Set([
  "runtime",
  "outputs",
  "inputs",
  "dependsOn",
  ...OPTIONAL_STEP_PROPS,
]);

function knownProps(...extra: string[]): ReadonlySet<string> {
  return new Set([...KNOWN_STEP_PROPS, ...extra]);
}

/** Metadata type used to carry config warnings through the construct tree. */
export const WARNING_METADATA_TYPE = "sverka:warning";

/** Attach a warning for every prop key not in the known set. Unknown props
 * are silently ignored otherwise — this is how `dependencies:` (a non-existent
 * prop) once swallowed a config's entire dependency wiring. */
function warnUnknownProps(
  construct: Construct,
  props: object,
  knownKeys: ReadonlySet<string>,
): void {
  for (const key of Object.keys(props)) {
    if (!knownKeys.has(key)) {
      construct.node.addMetadata(
        WARNING_METADATA_TYPE,
        `unknown prop '${key}' on '${construct.node.id}' — will be ignored`,
      );
    }
  }
}

/** Collect all config warnings attached to constructs under `root`. */
export function collectConstructWarnings(root: Construct): string[] {
  const out: string[] = [];
  for (const c of root.node.findAll()) {
    for (const entry of c.node.metadata) {
      if (entry.type === WARNING_METADATA_TYPE && typeof entry.data === "string") {
        out.push(`${c.node.path}: ${entry.data}`);
      }
    }
  }
  return out;
}

/** Copy optional `StepProps` fields onto the `Step` instance.
 * Array-valued properties are cloned to prevent caller mutation from
 * affecting the synthesized graph after construction. */
function applyOptionalStepProps(step: Step, props: StepProps): void {
  for (const key of OPTIONAL_STEP_PROPS) {
    const value = props[key];
    if (value !== undefined) {
      if (Array.isArray(value)) {
        (step as unknown as Record<string, unknown>)[key] = [...value];
      } else {
        (step as unknown as Record<string, unknown>)[key] = value;
      }
    }
  }
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
  readonly permissions?: StepPermissions;
  readonly compensation?: OperationDefinition;

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
    applyOptionalStepProps(this, props);
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
    warnUnknownProps(this, props, knownProps("command", "background"));
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
    warnUnknownProps(this, props, knownProps("callee", "callInputs"));
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
    warnUnknownProps(this, props, knownProps("component"));
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
    warnUnknownProps(this, props, knownProps("childPipeline"));
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
    warnUnknownProps(this, props, knownProps("downstream"));
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
    warnUnknownProps(this, props, knownProps("release"));
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
    warnUnknownProps(this, props, knownProps("pages"));
  }
}

// ---------------------------------------------------------------------------
// AgentStep — AI agent as a step type (Spec 27).
// ---------------------------------------------------------------------------

export interface AgentStepProps extends StepProps {
  readonly engine: string;
  readonly model?: string;
  readonly prompt: string;
  readonly tools?: readonly AgentToolRef[];
  readonly maxTokens?: number;
}

export class AgentStep extends Step {
  readonly engine: string;
  readonly model?: string;
  readonly prompt: string;
  readonly tools: readonly AgentToolRef[];
  readonly maxTokens?: number;

  constructor(scope: Pipeline, id: string, props: AgentStepProps) {
    super(scope, id, props);
    this.engine = props.engine;
    if (props.model !== undefined) {
      this.model = props.model;
    }
    this.prompt = props.prompt;
    this.tools = props.tools ? [...props.tools] : [];
    if (props.maxTokens !== undefined) {
      this.maxTokens = props.maxTokens;
    }
    warnUnknownProps(this, props, knownProps("engine", "model", "prompt", "tools", "maxTokens"));
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
    warnUnknownProps(this, props, new Set(["trigger", "roots"]));
  }
}
