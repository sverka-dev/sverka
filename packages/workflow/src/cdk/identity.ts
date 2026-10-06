// Structural kind markers for construct classes.
//
// `instanceof` fails when two copies of @sverka/workflow coexist (published
// CLI bundling its own copy next to the project's dependency). `Symbol.for`
// lives in the global registry, so a marker set by one copy is readable by
// the other — the constructs-library idiom for cross-realm discrimination.
//
// Each class stamps its own symbol as an instance field; the `is*` helpers
// are the ONLY supported way to check construct kinds across package copies.

import type {
  Project,
  Pipeline,
  Step,
  ShellStep,
  PipelineCallStep,
  ComponentStep,
  ChildPipelineStep,
  DownstreamStep,
  ReleaseStep,
  PagesStep,
  AgentStep,
  Entry,
} from "./constructs.js";

export const PROJECT_MARKER = Symbol.for("sverka.Project");
export const PIPELINE_MARKER = Symbol.for("sverka.Pipeline");
export const STEP_MARKER = Symbol.for("sverka.Step");
export const SHELL_STEP_MARKER = Symbol.for("sverka.ShellStep");
export const PIPELINE_CALL_STEP_MARKER = Symbol.for("sverka.PipelineCallStep");
export const COMPONENT_STEP_MARKER = Symbol.for("sverka.ComponentStep");
export const CHILD_PIPELINE_STEP_MARKER = Symbol.for(
  "sverka.ChildPipelineStep",
);
export const DOWNSTREAM_STEP_MARKER = Symbol.for("sverka.DownstreamStep");
export const RELEASE_STEP_MARKER = Symbol.for("sverka.ReleaseStep");
export const PAGES_STEP_MARKER = Symbol.for("sverka.PagesStep");
export const AGENT_STEP_MARKER = Symbol.for("sverka.AgentStep");
export const ENTRY_MARKER = Symbol.for("sverka.Entry");

function marked(value: unknown, marker: symbol): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[marker] === true
  );
}

export function isProject(value: unknown): value is Project {
  return marked(value, PROJECT_MARKER);
}

export function isPipeline(value: unknown): value is Pipeline {
  return marked(value, PIPELINE_MARKER);
}

export function isStep(value: unknown): value is Step {
  return marked(value, STEP_MARKER);
}

export function isShellStep(value: unknown): value is ShellStep {
  return marked(value, SHELL_STEP_MARKER);
}

export function isPipelineCallStep(value: unknown): value is PipelineCallStep {
  return marked(value, PIPELINE_CALL_STEP_MARKER);
}

export function isComponentStep(value: unknown): value is ComponentStep {
  return marked(value, COMPONENT_STEP_MARKER);
}

export function isChildPipelineStep(
  value: unknown,
): value is ChildPipelineStep {
  return marked(value, CHILD_PIPELINE_STEP_MARKER);
}

export function isDownstreamStep(value: unknown): value is DownstreamStep {
  return marked(value, DOWNSTREAM_STEP_MARKER);
}

export function isReleaseStep(value: unknown): value is ReleaseStep {
  return marked(value, RELEASE_STEP_MARKER);
}

export function isPagesStep(value: unknown): value is PagesStep {
  return marked(value, PAGES_STEP_MARKER);
}

export function isAgentStep(value: unknown): value is AgentStep {
  return marked(value, AGENT_STEP_MARKER);
}

export function isEntry(value: unknown): value is Entry {
  return marked(value, ENTRY_MARKER);
}
