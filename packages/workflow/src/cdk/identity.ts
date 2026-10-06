// Structural kind markers for construct classes.
//
// `instanceof` fails when two copies of @sverka/workflow coexist (published
// CLI bundling its own copy next to the project's dependency). `Symbol.for`
// lives in the global registry, so a marker set by one copy is readable by
// the other — the constructs-library idiom for cross-realm discrimination.
//
// Each class stamps its own symbol as an instance field; the `is*` helpers
// are the ONLY supported way to check construct kinds across package copies.
// They also duck-type constructs built by PRE-MARKER copies, so a new CLI
// still accepts a config whose @sverka/workflow predates this scheme.

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

type Shaped = Record<string, unknown> & { node?: { scope?: unknown } };

/** Duck-type fallback for objects built by a pre-marker @sverka/workflow
 * copy — they carry no symbols, so discrimination keys on fields the
 * constructor always assigns. `instanceof Map`/`Array.isArray` are safe:
 * two module copies share the realm's intrinsics — only identity differs. */
const shaped = (v: unknown): v is Shaped =>
  typeof v === "object" && v !== null;

/** Marker + Construct-shape: every construct exposes `.node`, so a plain
 * object carrying only the symbol is still rejected. */
function marked(value: unknown, marker: symbol): boolean {
  return (
    shaped(value) &&
    shaped(value.node) &&
    (value as Record<symbol, unknown>)[marker] === true
  );
}

export function isProject(value: unknown): value is Project {
  return (
    marked(value, PROJECT_MARKER) ||
    // Only Project is constructed with no scope — a root Construct.
    (shaped(value) &&
      value.node !== undefined &&
      value.node.scope === undefined)
  );
}

export function isPipeline(value: unknown): value is Pipeline {
  return (
    marked(value, PIPELINE_MARKER) ||
    // inputs is a Map only on Pipeline — on Step it's a readonly array.
    (shaped(value) && value.inputs instanceof Map)
  );
}

export function isStep(value: unknown): value is Step {
  return (
    marked(value, STEP_MARKER) ||
    (shaped(value) &&
      shaped(value.runtime) &&
      value.outputs instanceof Map &&
      Array.isArray(value.dependsOn))
  );
}

export function isShellStep(value: unknown): value is ShellStep {
  return (
    marked(value, SHELL_STEP_MARKER) ||
    (isStep(value) && shaped(value) && typeof value.command === "string")
  );
}

export function isPipelineCallStep(value: unknown): value is PipelineCallStep {
  return (
    marked(value, PIPELINE_CALL_STEP_MARKER) ||
    (isStep(value) && shaped(value) && typeof value.callee === "string")
  );
}

export function isComponentStep(value: unknown): value is ComponentStep {
  return (
    marked(value, COMPONENT_STEP_MARKER) ||
    (isStep(value) && shaped(value) && shaped(value.component))
  );
}

export function isChildPipelineStep(
  value: unknown,
): value is ChildPipelineStep {
  return (
    marked(value, CHILD_PIPELINE_STEP_MARKER) ||
    (isStep(value) && shaped(value) && shaped(value.childPipeline))
  );
}

export function isDownstreamStep(value: unknown): value is DownstreamStep {
  return (
    marked(value, DOWNSTREAM_STEP_MARKER) ||
    (isStep(value) && shaped(value) && shaped(value.downstream))
  );
}

export function isReleaseStep(value: unknown): value is ReleaseStep {
  return (
    marked(value, RELEASE_STEP_MARKER) ||
    (isStep(value) && shaped(value) && shaped(value.release))
  );
}

export function isPagesStep(value: unknown): value is PagesStep {
  return (
    marked(value, PAGES_STEP_MARKER) || (isStep(value) && shaped(value) && shaped(value.pages))
  );
}

export function isAgentStep(value: unknown): value is AgentStep {
  return (
    marked(value, AGENT_STEP_MARKER) ||
    (isStep(value) &&
      shaped(value) &&
      typeof value.engine === "string" &&
      typeof value.prompt === "string")
  );
}

export function isEntry(value: unknown): value is Entry {
  return (
    marked(value, ENTRY_MARKER) ||
    (shaped(value) && Array.isArray(value.roots) && shaped(value.trigger))
  );
}
