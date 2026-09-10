// @sverka/playground — minimal pipeline model. Browser-safe.
// Mirrors @sverka/workflow Construct API but simplified for browser use.

import type { PlaygroundFinding } from "./types.js";

/** Base class for all constructs. */
export abstract class Construct {
  readonly id: string;
  readonly scope: Construct | null;

  constructor(scope: Construct | null, id: string) {
    this.id = id;
    this.scope = scope;
  }

  /** Full path from root to this construct. */
  get path(): string {
    if (this.scope && this.scope.id !== "root") {
      return `${this.scope.path}/${this.id}`;
    }
    return this.id;
  }
}

/** Root construct representing a project. */
export class Project extends Construct {
  readonly pipelines: Pipeline[] = [];

  constructor(id: string) {
    super(null, id);
  }

  /** Add a pipeline to this project. */
  addPipeline(pipeline: Pipeline): void {
    this.pipelines.push(pipeline);
  }
}

/** A pipeline containing steps. */
export class Pipeline extends Construct {
  readonly steps: Step[] = [];
  readonly entries: Entry[] = [];

  constructor(project: Project, id: string) {
    super(project, id);
    project.addPipeline(this);
  }

  /** Add a step to this pipeline. */
  addStep(step: Step): void {
    this.steps.push(step);
  }

  /** Add an entry to this pipeline. */
  addEntry(entry: Entry): void {
    this.entries.push(entry);
  }
}

/** Base class for all step types. */
export abstract class Step extends Construct {
  readonly dependencies: string[];

  constructor(pipeline: Pipeline, id: string, dependencies: string[] = []) {
    super(pipeline, id);
    this.dependencies = dependencies;
    pipeline.addStep(this);
  }

  /** Execute this step and return findings. */
  abstract execute(): Promise<PlaygroundFinding[]> | PlaygroundFinding[];
}

/** A step that runs a JavaScript function in the browser. */
export class FunctionStep extends Step {
  readonly fn: () => Promise<PlaygroundFinding[]> | PlaygroundFinding[];

  constructor(
    pipeline: Pipeline,
    id: string,
    options: {
      fn: () => Promise<PlaygroundFinding[]> | PlaygroundFinding[];
      dependencies?: string[];
    },
  ) {
    super(pipeline, id, options.dependencies ?? []);
    this.fn = options.fn;
  }

  execute(): Promise<PlaygroundFinding[]> | PlaygroundFinding[] {
    return this.fn();
  }
}

/** An entry point that triggers a pipeline. */
export class Entry {
  readonly pipeline: Pipeline;
  readonly id: string;
  readonly trigger: { kind: string };
  readonly roots: string[];

  constructor(
    pipeline: Pipeline,
    id: string,
    options: { trigger: { kind: string }; roots: string[] },
  ) {
    this.pipeline = pipeline;
    this.id = id;
    this.trigger = options.trigger;
    this.roots = options.roots;
    pipeline.addEntry(this);
  }
}
