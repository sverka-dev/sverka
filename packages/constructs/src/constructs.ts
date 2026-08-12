// Construct classes: Project, Pipeline, Step, ShellStep, Entry.
// Spec 01 — §9.1, §10.

import { Construct } from "constructs";
import { SverkaConstruct } from "./base.js";
import { ConstructError } from "./errors.js";
import type {
  Input,
  OutputDeclaration,
  Reference,
  Runtime,
  Trigger,
} from "./model.js";

// ---------------------------------------------------------------------------
// Project — root of the construct tree (scope = undefined).
// ---------------------------------------------------------------------------

export class Project extends SverkaConstruct {
  constructor(id: string) {
    // constructs.Construct accepts undefined scope at runtime for root.
    super(undefined as unknown as SverkaConstruct, id);
  }
}

// ---------------------------------------------------------------------------
// Pipeline — contains Steps and Entries.
// ---------------------------------------------------------------------------

export interface PipelineProps {
  readonly inputs?: Readonly<Record<string, Input>>;
}

export class Pipeline extends SverkaConstruct {
  readonly inputs: ReadonlyMap<string, Input>;

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
      throw new ConstructError("DUPLICATE_ID", `Duplicate id '${id}' in Project`, err);
    }
    this.inputs = props?.inputs
      ? new Map(Object.entries(props.inputs))
      : new Map();
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
}

export abstract class Step extends SverkaConstruct {
  readonly runtime: Runtime;
  readonly outputs: ReadonlyMap<string, OutputDeclaration>;
  readonly inputs: ReadonlyArray<Reference>;
  readonly dependsOn: ReadonlyArray<string>;
  readonly timeout?: number;

  constructor(scope: Pipeline, id: string, props: StepProps) {
    if (!(scope instanceof Pipeline)) {
      throw new ConstructError(
        "INVALID_SCOPE",
        "Step must be created under a Pipeline",
      );
    }
    try {
      super(scope, id);
    } catch (err) {
      throw new ConstructError("DUPLICATE_ID", `Duplicate id '${id}' in Pipeline`, err);
    }
    this.runtime = props.runtime ?? {};
    this.outputs = props.outputs
      ? new Map(Object.entries(props.outputs))
      : new Map();
    this.inputs = props.inputs ? [...props.inputs] : [];
    this.dependsOn = props.dependsOn ? [...props.dependsOn] : [];
    if (props.timeout !== undefined) {
      this.timeout = props.timeout;
    }

    // Validate artifact outputs have a path.
    for (const [name, decl] of this.outputs) {
      if (decl.type === "artifact" && !decl.path) {
        throw new ConstructError(
          "INVALID_OUTPUT",
          `Artifact output '${name}' on step '${this.node.path}' must have a path`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// ShellStep — concrete shell-command step (§9.1, §15).
// ---------------------------------------------------------------------------

export interface ShellStepProps extends StepProps {
  readonly command: string;
}

export class ShellStep extends Step {
  readonly command: string;

  constructor(scope: Pipeline, id: string, props: ShellStepProps) {
    super(scope, id, props);
    this.command = props.command;
  }
}

// ---------------------------------------------------------------------------
// Entry — binds a Trigger to root Steps (§13).
// ---------------------------------------------------------------------------

export interface EntryProps {
  readonly trigger: Trigger;
  readonly roots: readonly string[];
}

export class Entry extends SverkaConstruct {
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
      throw new ConstructError("DUPLICATE_ID", `Duplicate id '${id}' in Pipeline`, err);
    }
    this.trigger = props.trigger;
    this.roots = [...props.roots];
  }
}
