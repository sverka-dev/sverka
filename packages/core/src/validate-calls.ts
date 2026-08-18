// Validation for pipeline-to-pipeline calls (F-31).
// Checks: callee existence, input bindings (required present, type match,
// no unknown inputs), call-graph acyclicity, nesting depth <= 4.

import type { PipelineDefinition, StepDefinition } from "./graph.js";
import type { Input, InputLiteral } from "@sverka/cdk";
import { SynthesisError } from "./errors.js";

export const MAX_PIPELINE_CALL_DEPTH = 4;

/**
 * Validate all pipeline-call steps across the project's pipelines.
 * Must run AFTER resolveCallOutputs (callee outputs copied onto call steps).
 */
export function validatePipelineCalls(pipelines: readonly PipelineDefinition[]): void {
  const byId = new Map(pipelines.map((p) => [p.id, p]));

  for (const pipeline of pipelines) {
    for (const step of pipeline.steps) {
      if (!step.call) continue;
      validateCallStep(step, pipeline.id, byId);
    }
  }

  validateCallGraph(pipelines, byId);
}

function validateCallStep(
  step: StepDefinition,
  pipelineId: string,
  byId: Map<string, PipelineDefinition>,
): void {
  const callee = byId.get(step.call!.callee);
  if (!callee) {
    throw new SynthesisError(
      "UNKNOWN_CALLEE",
      `Step '${step.id}' calls unknown pipeline '${step.call!.callee}'`,
      step.id,
    );
  }

  const calleeInputs = callee.inputs;
  const bindings = step.call!.inputs;

  for (const [inputName, inputSpec] of Object.entries(calleeInputs)) {
    const binding = bindings[inputName];
    if (binding === undefined) {
      if (inputSpec.required && inputSpec.default === undefined) {
        throw new SynthesisError(
          "MISSING_INPUT_BINDING",
          `Step '${step.id}' does not bind required input '${inputName}' of callee '${callee.id}'`,
          step.id,
        );
      }
      continue;
    }
    // Type-check literal bindings (Reference bindings are checked at expansion).
    if (typeof binding !== "object" || binding === null) {
      validateLiteralType(binding as InputLiteral, inputSpec, inputName, step.id, callee.id);
    }
  }

  // No bindings to undeclared callee inputs.
  for (const inputName of Object.keys(bindings)) {
    if (!(inputName in calleeInputs)) {
      throw new SynthesisError(
        "UNKNOWN_INPUT",
        `Step '${step.id}' binds unknown input '${inputName}' on callee '${callee.id}'`,
        step.id,
      );
    }
  }
}

function validateLiteralType(
  value: InputLiteral,
  input: Input,
  inputName: string,
  stepId: string,
  calleeId: string,
): void {
  if (input.type === "array") {
    if (!Array.isArray(value)) {
      throw new SynthesisError(
        "INPUT_TYPE_MISMATCH",
        `Step '${stepId}' binds input '${inputName}' (type 'array') with value of type '${typeof value}' on callee '${calleeId}'`,
        stepId,
      );
    }
    return;
  }
  if (input.type === "choice") {
    if (typeof value !== "string") {
      throw new SynthesisError(
        "INPUT_TYPE_MISMATCH",
        `Step '${stepId}' binds input '${inputName}' (type 'choice') with value of type '${typeof value}' on callee '${calleeId}'`,
        stepId,
      );
    }
    if (input.options !== undefined && !input.options.includes(value)) {
      throw new SynthesisError(
        "INPUT_TYPE_MISMATCH",
        `Step '${stepId}' binds input '${inputName}' with value '${value}' not in allowed options on callee '${calleeId}'`,
        stepId,
      );
    }
    return;
  }
  const actual = typeof value;
  if (
    (input.type === "string" && actual !== "string") ||
    (input.type === "number" && actual !== "number") ||
    (input.type === "boolean" && actual !== "boolean")
  ) {
    throw new SynthesisError(
      "INPUT_TYPE_MISMATCH",
      `Step '${stepId}' binds input '${inputName}' (type '${input.type}') with value of type '${actual}' on callee '${calleeId}'`,
      stepId,
    );
  }
}

/**
 * Validate the pipeline-level call graph is acyclic and within depth limit.
 * Nodes are pipelines; edge A -> B means pipeline A has a step calling B.
 */
function validateCallGraph(
  pipelines: readonly PipelineDefinition[],
  byId: Map<string, PipelineDefinition>,
): void {
  // Build adjacency: pipelineId -> set of callee pipelineIds it calls.
  const calls = new Map<string, Set<string>>();
  for (const p of pipelines) {
    const callees = new Set<string>();
    for (const step of p.steps) {
      if (step.call && byId.has(step.call.callee)) {
        callees.add(step.call.callee);
      }
    }
    calls.set(p.id, callees);
  }

  // Cycle detection (DFS) + depth check.
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const p of pipelines) color.set(p.id, WHITE);

  function dfs(id: string, depth: number, path: string[]): void {
    if (depth > MAX_PIPELINE_CALL_DEPTH) {
      throw new SynthesisError(
        "NESTING_TOO_DEEP",
        `Pipeline call nesting exceeds max depth ${MAX_PIPELINE_CALL_DEPTH} at '${path.join(" -> ")}'`,
        path.at(-1),
      );
    }
    const c = color.get(id);
    if (c === BLACK) return;
    if (c === GRAY) {
      const cycleStart = path.indexOf(id);
      const cycle = path.slice(cycleStart).concat(id).join(" -> ");
      throw new SynthesisError("CALL_CYCLE", `Pipeline call cycle: ${cycle}`, id);
    }
    color.set(id, GRAY);
    for (const callee of calls.get(id) ?? []) {
      dfs(callee, depth + 1, [...path, callee]);
    }
    color.set(id, BLACK);
  }

  for (const p of pipelines) {
    if (color.get(p.id) === WHITE) {
      dfs(p.id, 0, [p.id]);
    }
  }
}
