// pipeline() factory — creates a Pipeline and runs step/entry functions.
// Spec 03 — §9.2.

import { Project, Pipeline, Entry } from "@sverka/constructs";
import type { Input } from "@sverka/constructs";

export interface PipelineConfig {
  inputs?: Readonly<Record<string, Input>>;
  steps?: ReadonlyArray<(pipeline: Pipeline) => void>;
  entries?: ReadonlyArray<(pipeline: Pipeline) => Entry>;
}

/** Create a Pipeline, run step functions, then entry functions. */
export function pipeline(project: Project, id: string, config: PipelineConfig): Pipeline {
  const p = new Pipeline(project, id, {
    ...(config.inputs ? { inputs: config.inputs } : {}),
  });

  if (config.steps) {
    for (const stepFn of config.steps) {
      stepFn(p);
    }
  }

  if (config.entries) {
    for (const entryFn of config.entries) {
      entryFn(p);
    }
  }

  return p;
}
