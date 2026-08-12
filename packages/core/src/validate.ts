// Validation functions for the Definition Graph.
// Spec 05 — §11.4.

import type { StepDefinition, Dependency } from "./graph.js";
import { SynthesisError } from "./errors.js";
import type { StepRef, OutputDeclaration } from "@sverka/constructs";

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
    color.set(id, GRAY);
    const step = stepMap.get(id);
    if (step) {
      for (const dep of step.dependencies) {
        dfs(dep.producer);
      }
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
        // Step references are relative within the pipeline — resolve to full id.
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
  }
}

/**
 * Validate that no step has duplicate output names.
 * Throws SynthesisError(OUTPUT_COLLISION).
 */
export function validateOutputCollisions(steps: readonly StepDefinition[]): void {
  for (const step of steps) {
    const seen = new Set<string>();
    for (const out of step.outputs) {
      // outputs is an array of OutputDeclaration with names from the map keys.
      // Actually outputs is readonly OutputDeclaration[] — but we need names.
      // The StepDefinition.outputs is OutputDeclaration[] without names baked in.
      // We need to check via the operations (exportOutput/exportArtifact names).
    }
    // Check via operations for duplicate export names.
    const exportNames = new Set<string>();
    for (const op of step.operations) {
      if (op.kind === "exportOutput" || op.kind === "exportArtifact") {
        if (exportNames.has(op.name)) {
          throw new SynthesisError(
            "OUTPUT_COLLISION",
            `Step '${step.id}' has duplicate output name '${op.name}'`,
            step.id,
          );
        }
        exportNames.add(op.name);
      }
    }
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
  // Build a map of stepId → output name → OutputType.
  const outputTypes = new Map<string, Map<string, string>>();
  for (const step of steps) {
    const outs = new Map<string, string>();
    for (const op of step.operations) {
      if (op.kind === "exportOutput") {
        outs.set(op.name, op.type);
      } else if (op.kind === "exportArtifact") {
        outs.set(op.name, "artifact");
      }
    }
    outputTypes.set(step.id, outs);
  }

  for (const step of steps) {
    for (const input of step.inputs) {
      if (input.kind === "step") {
        const ref: StepRef = input;
        const producerId = resolveStepId(pipelineId, ref.step);
        const producerOutputs = outputTypes.get(producerId);
        if (!producerOutputs) continue; // UNKNOWN_PRODUCER handles this
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
    }
  }
}

/**
 * Resolve a step reference name to a full step id within a pipeline.
 * Step references use the step's local name (e.g. "build"), while step ids
 * include the pipeline path (e.g. "ci/build").
 */
function resolveStepId(pipelineId: string, stepName: string): string {
  // If the reference already includes the pipeline prefix, use as-is.
  if (stepName.startsWith(`${pipelineId}/`)) {
    return stepName;
  }
  return `${pipelineId}/${stepName}`;
}
