// Validation functions for the Definition Graph.
// Spec 05 — §11.4.

import type { StepDefinition, DefinitionGraph } from "./graph.js";
import { SynthesisError } from "./errors.js";
import type { StepRef, OutputType } from "../cdk/index.js";

/**
 * Detect cycles in the dependency graph using DFS.
 * Throws SynthesisError(CYCLE) on first cycle found.
 */
export function detectCycles(steps: readonly StepDefinition[]): void {
  const stepMap = new Map(steps.map((s) => [s.id, s]));
  const WHITE = 0; // unvisited
  const GRAY = 1; // in current DFS path
  const BLACK = 2; // fully processed
  const color = new Map<string, number>();
  for (const s of steps) {
    color.set(s.id, WHITE);
  }

  function dfs(id: string): void {
    const c = color.get(id);
    if (c === BLACK) return;
    if (c === GRAY) {
      throw new SynthesisError("CYCLE", `Dependency cycle detected at step '${id}'`, id);
    }
    const step = stepMap.get(id);
    if (!step) {
      throw new SynthesisError(
        "UNKNOWN_PRODUCER",
        `Step '${id}' not found during cycle detection`,
        id,
      );
    }
    color.set(id, GRAY);
    for (const dep of step.dependencies) {
      dfs(dep.producer);
    }
    color.set(id, BLACK);
  }

  for (const s of steps) {
    if (color.get(s.id) === WHITE) {
      dfs(s.id);
    }
  }
}

/**
 * Validate that all explicit dependencies (including control dependencies from
 * dependsOn) point to existing steps in the pipeline.
 * Throws SynthesisError(UNKNOWN_PRODUCER).
 */
export function validateDependencies(steps: readonly StepDefinition[]): void {
  const stepIds = new Set(steps.map((s) => s.id));
  for (const step of steps) {
    for (const dep of step.dependencies) {
      if (!stepIds.has(dep.producer)) {
        throw new SynthesisError(
          "UNKNOWN_PRODUCER",
          `Step '${step.id}' depends on unknown producer '${dep.producer}'`,
          step.id,
        );
      }
    }
  }
}

/**
 * Validate that all StepRef inputs point to existing steps in the pipeline.
 * Throws SynthesisError(UNKNOWN_PRODUCER).
 */
export function validateReferences(
  steps: readonly StepDefinition[],
  pipelineId: string,
): void {
  const stepIds = new Set(steps.map((s) => s.id));
  for (const step of steps) {
    for (const input of step.inputs) {
      if (input.kind === "step") {
        const ref: StepRef = input;
        const producerId = resolveStepId(pipelineId, ref.step);
        if (!stepIds.has(producerId)) {
          throw new SynthesisError(
            "UNKNOWN_PRODUCER",
            `Step '${step.id}' references unknown producer '${ref.step}'`,
            step.id,
          );
        }
      }
    }

    if (step.condition?.kind === "step") {
      const ref: StepRef = step.condition;
      const producerId = resolveStepId(pipelineId, ref.step);
      if (!stepIds.has(producerId)) {
        throw new SynthesisError(
          "UNKNOWN_PRODUCER",
          `Step '${step.id}' condition references unknown producer '${ref.step}'`,
          step.id,
        );
      }
    }
  }
}

/**
 * Validate that no step has duplicate output names.
 * Throws SynthesisError(OUTPUT_COLLISION).
 */
export function validateOutputCollisions(steps: readonly StepDefinition[]): void {
  for (const step of steps) {
    const names = new Set<string>();
    for (const op of step.operations) {
      if (
        op.kind === "exportOutput" ||
        op.kind === "exportArtifact" ||
        op.kind === "importArtifact"
      ) {
        if (names.has(op.name)) {
          throw new SynthesisError(
            "OUTPUT_COLLISION",
            `Step '${step.id}' has duplicate output name '${op.name}'`,
            step.id,
          );
        }
        names.add(op.name);
      }
    }
  }
}

function buildOutputTypeMap(
  steps: readonly StepDefinition[],
): Map<string, Map<string, OutputType>> {
  const outputTypes = new Map<string, Map<string, OutputType>>();
  for (const step of steps) {
    const outs = new Map<string, OutputType>();
    // Export operations (shell steps).
    for (const op of step.operations) {
      if (op.kind === "exportOutput") {
        outs.set(op.name, op.type);
      } else if (op.kind === "exportArtifact") {
        outs.set(op.name, "artifact");
      }
    }
    // Call-step outputs (copied from callee at synthesis — no operations).
    for (const out of step.outputs) {
      if (!outs.has(out.name)) {
        outs.set(out.name, out.type);
      }
    }
    outputTypes.set(step.id, outs);
  }
  return outputTypes;
}

function validateInputReference(
  step: StepDefinition,
  ref: StepRef,
  outputTypes: Map<string, Map<string, OutputType>>,
  pipelineId: string,
): void {
  const producerId = resolveStepId(pipelineId, ref.step);
  const producerOutputs = outputTypes.get(producerId);
  if (!producerOutputs) {
    // UNKNOWN_PRODUCER is reported by validateReferences/validateDependencies.
    return;
  }
  const declaredType = producerOutputs.get(ref.output);
  if (declaredType === undefined) {
    throw new SynthesisError(
      "INCOMPATIBLE_REFERENCE",
      `Step '${step.id}' references output '${ref.output}' which doesn't exist on producer '${ref.step}'`,
      step.id,
    );
  }
  if (declaredType !== ref.type) {
    throw new SynthesisError(
      "INCOMPATIBLE_REFERENCE",
      `Step '${step.id}' references '${ref.output}' as type '${ref.type}' but producer declares '${declaredType}'`,
      step.id,
    );
  }
}

function validateConditionReference(
  step: StepDefinition,
  ref: StepRef,
  outputTypes: Map<string, Map<string, OutputType>>,
  pipelineId: string,
): void {
  validateInputReference(step, ref, outputTypes, pipelineId);
  if (ref.type !== "boolean") {
    throw new SynthesisError(
      "INCOMPATIBLE_REFERENCE",
      `Step '${step.id}' condition must reference a boolean output, got '${ref.type}'`,
      step.id,
    );
  }
}

/**
 * Validate that StepRef types match the producer's output type.
 * Throws SynthesisError(INCOMPATIBLE_REFERENCE).
 */
export function validateReferenceTypes(
  steps: readonly StepDefinition[],
  pipelineId: string,
): void {
  const outputTypes = buildOutputTypeMap(steps);
  for (const step of steps) {
    for (const input of step.inputs) {
      if (input.kind === "step") {
        validateInputReference(step, input as StepRef, outputTypes, pipelineId);
      }
    }
    validateStepConditionRefs(step, outputTypes, pipelineId);
  }
}

/**
 * Validate references inside a step's condition (step ref or expression refs).
 */
function validateStepConditionRefs(
  step: StepDefinition,
  outputTypes: Map<string, Map<string, OutputType>>,
  pipelineId: string,
): void {
  const cond = step.condition;
  if (!cond) return;
  if (cond.kind === "step") {
    validateConditionReference(step, cond as StepRef, outputTypes, pipelineId);
    return;
  }
  if (cond.kind === "expression") {
    for (const ref of cond.refs) {
      if (ref.kind === "step") {
        validateInputReference(step, ref as StepRef, outputTypes, pipelineId);
      }
    }
  }
}

/**
 * Resolve a step reference name to a full step id within a pipeline.
 * Step references use the step's local name (e.g. "build"), while step ids
 * include the pipeline path (e.g. "ci/build").
 */
export function resolveStepId(pipelineId: string, stepName: string): string {
  // If the reference already includes the pipeline prefix, use as-is.
  if (stepName.startsWith(`${pipelineId}/`)) {
    return stepName;
  }
  return `${pipelineId}/${stepName}`;
}

/**
 * Validate a complete Definition Graph — runs all 4 validators per pipeline.
 * Throws SynthesisError on first failure. Used by IR deserialization to
 * ensure semantic validity after schema validation passes.
 */
export function validateGraph(graph: DefinitionGraph): void {
  for (const pipeline of graph.project.pipelines) {
    const steps = pipeline.steps;
    const stepIds = new Set(steps.map((s) => s.id));
    validateOutputCollisions(steps);
    validateDependencies(steps);
    validateReferences(steps, pipeline.id);
    validateReferenceTypes(steps, pipeline.id);
    detectCycles(steps);
    for (const entry of pipeline.entries) {
      if (entry.roots.length === 0) {
        throw new SynthesisError(
          "INVALID_ENTRY",
          `Entry '${entry.id}' in pipeline '${pipeline.id}' has no roots`,
          entry.id,
        );
      }
      for (const root of entry.roots) {
        if (!stepIds.has(root)) {
          throw new SynthesisError(
            "UNKNOWN_PRODUCER",
            `Entry '${entry.id}' in pipeline '${pipeline.id}' references unknown root step '${root}'`,
            root,
          );
        }
      }
    }
  }
}
