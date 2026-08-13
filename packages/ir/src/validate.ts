// Schema validation for SerializableGraph and RunPlan.
// Spec 06 — Validation. Throws ValidationError on failure.
// Delegates semantic validation to core's validateGraph.

import { validateGraph, type DefinitionGraph } from "@sverka/core";
import { ValidationError } from "./errors.js";
import type { SerializableGraph } from "./serialize.js";
import type { RunPlan } from "./run-plan.js";
import { GRAPH_SCHEMA_VERSION, RUN_PLAN_SCHEMA_VERSION } from "./version.js";

/**
 * Validate that a value is a structurally valid SerializableGraph.
 * Calls core validateGraph for semantic checks (cycles, unknown producers,
 * output collisions, incompatible references).
 */
export function validateGraphSchema(value: unknown): asserts value is SerializableGraph {
  if (typeof value !== "object" || value === null) {
    throw new ValidationError("expected an object");
  }
  const v = value as Record<string, unknown>;
  if (v.apiVersion !== GRAPH_SCHEMA_VERSION) {
    throw new ValidationError(`expected apiVersion '${GRAPH_SCHEMA_VERSION}', got '${String(v.apiVersion)}'`);
  }
  if (typeof v.id !== "string") {
    throw new ValidationError("missing or invalid 'id' field");
  }
  if (typeof v.createdAt !== "string") {
    throw new ValidationError("missing or invalid 'createdAt' field");
  }
  if (typeof v.graph !== "object" || v.graph === null) {
    throw new ValidationError("missing or invalid 'graph' field");
  }
  // Validate the graph structure.
  validateGraphStructure(v.graph as unknown);
  // Semantic validation via core.
  try {
    validateGraph(v.graph as DefinitionGraph);
  } catch (err) {
    throw new ValidationError(
      err instanceof Error ? err.message : "semantic validation failed",
      err,
    );
  }
}

/**
 * Validate that a value is a structurally valid RunPlan.
 */
export function validateRunPlanSchema(value: unknown): asserts value is RunPlan {
  if (typeof value !== "object" || value === null) {
    throw new ValidationError("expected an object");
  }
  const v = value as Record<string, unknown>;
  if (v.apiVersion !== RUN_PLAN_SCHEMA_VERSION) {
    throw new ValidationError(`expected apiVersion '${RUN_PLAN_SCHEMA_VERSION}', got '${String(v.apiVersion)}'`);
  }
  if (typeof v.id !== "string") {
    throw new ValidationError("missing or invalid 'id' field");
  }
  if (typeof v.graphId !== "string") {
    throw new ValidationError("missing or invalid 'graphId' field");
  }
  if (typeof v.createdAt !== "string") {
    throw new ValidationError("missing or invalid 'createdAt' field");
  }
  if (typeof v.entry !== "object" || v.entry === null) {
    throw new ValidationError("missing or invalid 'entry' field");
  }
  validateBoundEntry(v.entry as unknown);
  if (typeof v.inputs !== "object" || v.inputs === null || Array.isArray(v.inputs)) {
    throw new ValidationError("missing or invalid 'inputs' field (expected object)");
  }
  if (!Array.isArray(v.steps)) {
    throw new ValidationError("missing or invalid 'steps' field (expected array)");
  }
  for (const step of v.steps) {
    validateStepStructure(step);
  }
}

function validateBoundEntry(value: unknown): void {
  if (typeof value !== "object" || value === null) {
    throw new ValidationError("invalid entry: expected object");
  }
  const e = value as Record<string, unknown>;
  if (typeof e.id !== "string") {
    throw new ValidationError("invalid entry: missing 'id'");
  }
  if (typeof e.trigger !== "object" || e.trigger === null) {
    throw new ValidationError("invalid entry: missing 'trigger'");
  }
  const t = e.trigger as Record<string, unknown>;
  if (t.kind !== "push" && t.kind !== "changeRequest" && t.kind !== "manual") {
    throw new ValidationError(`invalid entry: unknown trigger kind '${String(t.kind)}'`);
  }
}

function validateGraphStructure(value: unknown): void {
  if (typeof value !== "object" || value === null) {
    throw new ValidationError("invalid graph: expected object");
  }
  const g = value as Record<string, unknown>;
  if (typeof g.project !== "object" || g.project === null) {
    throw new ValidationError("invalid graph: missing 'project'");
  }
  const p = g.project as Record<string, unknown>;
  if (typeof p.id !== "string") {
    throw new ValidationError("invalid graph: project missing 'id'");
  }
  if (!Array.isArray(p.pipelines)) {
    throw new ValidationError("invalid graph: project missing 'pipelines' array");
  }
  for (const pipeline of p.pipelines) {
    validatePipelineStructure(pipeline);
  }
}

function validatePipelineStructure(value: unknown): void {
  if (typeof value !== "object" || value === null) {
    throw new ValidationError("invalid pipeline: expected object");
  }
  const p = value as Record<string, unknown>;
  if (typeof p.id !== "string") {
    throw new ValidationError("invalid pipeline: missing 'id'");
  }
  if (!Array.isArray(p.inputs)) {
    throw new ValidationError("invalid pipeline: missing 'inputs' array");
  }
  if (!Array.isArray(p.entries)) {
    throw new ValidationError("invalid pipeline: missing 'entries' array");
  }
  if (!Array.isArray(p.steps)) {
    throw new ValidationError("invalid pipeline: missing 'steps' array");
  }
  if (!Array.isArray(p.outputs)) {
    throw new ValidationError("invalid pipeline: missing 'outputs' array");
  }
  for (const step of p.steps) {
    validateStepStructure(step);
  }
}

function validateStepStructure(value: unknown): void {
  if (typeof value !== "object" || value === null) {
    throw new ValidationError("invalid step: expected object");
  }
  const s = value as Record<string, unknown>;
  if (typeof s.id !== "string") {
    throw new ValidationError("invalid step: missing 'id'");
  }
  if (typeof s.runtime !== "object" || s.runtime === null) {
    throw new ValidationError("invalid step: missing 'runtime'");
  }
  if (!Array.isArray(s.operations)) {
    throw new ValidationError("invalid step: missing 'operations' array");
  }
  if (!Array.isArray(s.inputs)) {
    throw new ValidationError("invalid step: missing 'inputs' array");
  }
  if (!Array.isArray(s.outputs)) {
    throw new ValidationError("invalid step: missing 'outputs' array");
  }
  if (!Array.isArray(s.dependencies)) {
    throw new ValidationError("invalid step: missing 'dependencies' array");
  }
}
