// Serialization for Definition Graph and Run Plan.
// Spec 06 — Functions. ADR-006 (amended).

import type { DefinitionGraph } from "@sverka/core";
import { canonicalStringify } from "./canonical.js";
import { validateGraphSchema, validateRunPlanSchema } from "./validate.js";
import { ValidationError, SerializationError } from "./errors.js";
import { computeGraphId, computeRunPlanId } from "./ids.js";
import { GRAPH_SCHEMA_VERSION } from "./version.js";
import type { RunPlan } from "./run-plan.js";

/** Serializable envelope wrapping a Definition Graph with version + id. */
export interface SerializableGraph {
  readonly apiVersion: "sverka.dev/v1graph";
  readonly id: string;
  readonly graph: DefinitionGraph;
  readonly createdAt: string;
}

/**
 * Serialize a Definition Graph to a canonical JSON string.
 * Produces a SerializableGraph envelope with deterministic id.
 */
export function serializeGraph(graph: DefinitionGraph): string {
  try {
    const envelope: SerializableGraph = {
      apiVersion: GRAPH_SCHEMA_VERSION,
      id: computeGraphId(graph),
      graph,
      createdAt: new Date().toISOString(),
    };
    return canonicalStringify(envelope);
  } catch (e) {
    throw new SerializationError(
      e instanceof Error ? e.message : "failed to serialize graph",
      e,
    );
  }
}

/**
 * Deserialize and validate a JSON string into a SerializableGraph.
 * Throws SerializationError on JSON parse failure, ValidationError on
 * schema or semantic validation failure.
 */
export function deserializeGraph(json: string): SerializableGraph {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new SerializationError(
      e instanceof Error ? e.message : "malformed JSON",
      e,
    );
  }
  validateGraphSchema(parsed);
  if (parsed.id !== computeGraphId(parsed.graph)) {
    throw new ValidationError("graph id does not match content-addressed hash");
  }
  return parsed;
}

/**
 * Serialize a Run Plan to a canonical JSON string.
 */
export function serializeRunPlan(plan: RunPlan): string {
  try {
    return canonicalStringify(plan);
  } catch (e) {
    throw new SerializationError(
      e instanceof Error ? e.message : "failed to serialize run plan",
      e,
    );
  }
}

/**
 * Deserialize and validate a JSON string into a RunPlan.
 * Throws SerializationError on JSON parse failure, ValidationError on
 * schema validation failure.
 */
export function deserializeRunPlan(json: string): RunPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new SerializationError(
      e instanceof Error ? e.message : "malformed JSON",
      e,
    );
  }
  validateRunPlanSchema(parsed);
  const { id: _id, createdAt: _createdAt, ...body } = parsed;
  if (parsed.id !== computeRunPlanId(body)) {
    throw new ValidationError("run plan id does not match content-addressed hash");
  }
  return parsed;
}

// Re-export for validate.ts to avoid circular import — validate imports
// SerializableGraph type from here, and this file imports validate at runtime.
// TypeScript handles type-only cycles fine.
