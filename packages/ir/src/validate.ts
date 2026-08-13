// Schema validation for SerializableGraph and RunPlan.
// Spec 06 — Validation. Throws ValidationError on failure.
// Delegates semantic validation to core's validateGraph.

import { validateGraph, type DefinitionGraph } from "@sverka/core";
import { ValidationError } from "./errors.js";
import type { SerializableGraph } from "./serialize.js";
import type { RunPlan, InputValue } from "./run-plan.js";
import { computeGraphId, computeRunPlanId } from "./ids.js";
import { GRAPH_SCHEMA_VERSION, RUN_PLAN_SCHEMA_VERSION } from "./version.js";

const OUTPUT_TYPES = new Set(["string", "number", "boolean", "artifact"]);
const TRIGGER_KINDS = new Set(["push", "changeRequest", "manual"]);
const SEVERITIES = new Set(["info", "warn", "error"]);
const CONTEXT_NAMESPACES = new Set([
  "env",
  "secrets",
  "git",
  "change",
  "event",
  "run",
  "inputs",
]);
const REFERENCE_KINDS = new Set(["step", "context"]);
const OPERATION_KINDS = new Set([
  "shell",
  "exportOutput",
  "exportArtifact",
  "importArtifact",
  "diagnostic",
]);
const DEPENDENCY_KINDS = new Set(["control", "value", "artifact"]);

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
  // Validate the graph structure and element shapes.
  validateGraphStructure(v.graph as unknown);

  // Enforce the content-addressed id contract before semantic validation.
  const graph = v.graph as DefinitionGraph;
  let expectedId: string;
  try {
    expectedId = computeGraphId(graph);
  } catch (err) {
    throw new ValidationError(
      err instanceof Error ? err.message : "failed to compute graph id",
      err,
    );
  }
  if (v.id !== expectedId) {
    throw new ValidationError("graph id does not match content-addressed hash");
  }

  // Semantic validation via core.
  try {
    validateGraph(graph);
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
  validateInputs(v.inputs as Record<string, unknown>);
  if (!Array.isArray(v.steps)) {
    throw new ValidationError("missing or invalid 'steps' field (expected array)");
  }
  for (const step of v.steps) {
    validateStepStructure(step);
  }

  // Enforce the content-addressed id contract.
  const plan = value as RunPlan;
  const { id: _id, createdAt: _createdAt, ...body } = plan;
  let expectedId: string;
  try {
    expectedId = computeRunPlanId(body);
  } catch (err) {
    throw new ValidationError(
      err instanceof Error ? err.message : "failed to compute run plan id",
      err,
    );
  }
  if (plan.id !== expectedId) {
    throw new ValidationError("run plan id does not match content-addressed hash");
  }
}

function validateInputs(inputs: Record<string, unknown>): void {
  for (const [key, val] of Object.entries(inputs)) {
    validateInputValue(val, key);
  }
}

function validateInputValue(value: unknown, name: string): asserts value is InputValue {
  if (value === null || typeof value === "undefined") {
    throw new ValidationError(`input '${name}' must be a string, number, or boolean`);
  }
  if (typeof value === "number") {
    if (Number.isNaN(value) || !Number.isFinite(value)) {
      throw new ValidationError(`input '${name}' must be a finite number`);
    }
    return;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return;
  }
  throw new ValidationError(`input '${name}' must be a string, number, or boolean`);
}

function validateBoundEntry(value: unknown): void {
  if (typeof value !== "object" || value === null) {
    throw new ValidationError("invalid entry: expected object");
  }
  const e = value as Record<string, unknown>;
  if (typeof e.id !== "string" || e.id.length === 0) {
    throw new ValidationError("invalid entry: missing 'id'");
  }
  if (typeof e.trigger !== "object" || e.trigger === null) {
    throw new ValidationError("invalid entry: missing 'trigger'");
  }
  validateTrigger(e.trigger as unknown);
}

function validateTrigger(value: unknown): void {
  if (typeof value !== "object" || value === null) {
    throw new ValidationError("invalid trigger: expected object");
  }
  const t = value as Record<string, unknown>;
  if (typeof t.kind !== "string" || !TRIGGER_KINDS.has(t.kind)) {
    throw new ValidationError(`invalid entry: unknown trigger kind '${String(t.kind)}'`);
  }
  if (t.filter !== undefined) {
    validateTriggerFilter(t.filter);
  }
}

function validateTriggerFilter(value: unknown): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError("invalid trigger filter: expected object");
  }
  const f = value as Record<string, unknown>;
  for (const key of ["branches", "tags", "paths"]) {
    const arr = f[key];
    if (arr !== undefined && !isStringArray(arr)) {
      throw new ValidationError(`invalid trigger filter: '${key}' must be an array of strings`);
    }
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((x) => typeof x === "string");
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
  if (typeof p.id !== "string" || p.id.length === 0) {
    throw new ValidationError("invalid pipeline: missing 'id'");
  }
  if (!Array.isArray(p.inputs)) {
    throw new ValidationError("invalid pipeline: missing 'inputs' array");
  }
  for (const input of p.inputs) {
    validatePipelineInput(input);
  }
  if (!Array.isArray(p.entries)) {
    throw new ValidationError("invalid pipeline: missing 'entries' array");
  }
  for (const entry of p.entries) {
    validateEntryDefinition(entry);
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

function validatePipelineInput(value: unknown): void {
  if (typeof value !== "object" || value === null) {
    throw new ValidationError("invalid pipeline input: expected object");
  }
  const i = value as Record<string, unknown>;
  if (typeof i.name !== "string" || i.name.length === 0) {
    throw new ValidationError("invalid pipeline input: missing or invalid 'name'");
  }
  if (typeof i.type !== "string" || !OUTPUT_TYPES.has(i.type)) {
    throw new ValidationError("invalid pipeline input: missing or invalid 'type'");
  }
}

function validateEntryDefinition(value: unknown): void {
  if (typeof value !== "object" || value === null) {
    throw new ValidationError("invalid entry: expected object");
  }
  const e = value as Record<string, unknown>;
  if (typeof e.id !== "string" || e.id.length === 0) {
    throw new ValidationError("invalid entry: missing 'id'");
  }
  if (typeof e.trigger !== "object" || e.trigger === null) {
    throw new ValidationError("invalid entry: missing 'trigger'");
  }
  validateTrigger(e.trigger as unknown);
  if (!Array.isArray(e.roots) || !e.roots.every((r) => typeof r === "string" && r.length > 0)) {
    throw new ValidationError("invalid entry: 'roots' must be a non-empty array of step ids");
  }
}

function validateStepStructure(value: unknown): void {
  if (typeof value !== "object" || value === null) {
    throw new ValidationError("invalid step: expected object");
  }
  const s = value as Record<string, unknown>;
  if (typeof s.id !== "string" || s.id.length === 0) {
    throw new ValidationError("invalid step: missing 'id'");
  }
  if (typeof s.runtime !== "object" || s.runtime === null) {
    throw new ValidationError("invalid step: missing 'runtime'");
  }
  if (!Array.isArray(s.operations)) {
    throw new ValidationError("invalid step: missing 'operations' array");
  }
  for (const op of s.operations) {
    validateOperation(op);
  }
  if (!Array.isArray(s.inputs)) {
    throw new ValidationError("invalid step: missing 'inputs' array");
  }
  for (const input of s.inputs) {
    validateReference(input);
  }
  if (!Array.isArray(s.outputs)) {
    throw new ValidationError("invalid step: missing 'outputs' array");
  }
  for (const output of s.outputs) {
    validateOutputDefinition(output);
  }
  if (!Array.isArray(s.dependencies)) {
    throw new ValidationError("invalid step: missing 'dependencies' array");
  }
  for (const dep of s.dependencies) {
    validateDependency(dep);
  }
}

function validateOperation(value: unknown): void {
  if (typeof value !== "object" || value === null) {
    throw new ValidationError("invalid operation: expected object");
  }
  const op = value as Record<string, unknown>;
  if (typeof op.kind !== "string" || !OPERATION_KINDS.has(op.kind)) {
    throw new ValidationError(`invalid operation: unknown kind '${String(op.kind)}'`);
  }
  switch (op.kind) {
    case "shell":
      if (typeof op.command !== "string") {
        throw new ValidationError("invalid shell operation: missing 'command'");
      }
      return;
    case "exportOutput":
      if (typeof op.name !== "string" || !op.name) {
        throw new ValidationError("invalid exportOutput operation: missing 'name'");
      }
      if (typeof op.type !== "string" || !OUTPUT_TYPES.has(op.type)) {
        throw new ValidationError("invalid exportOutput operation: missing or invalid 'type'");
      }
      return;
    case "exportArtifact":
      if (typeof op.name !== "string" || !op.name) {
        throw new ValidationError("invalid exportArtifact operation: missing 'name'");
      }
      if (typeof op.path !== "string" || !op.path) {
        throw new ValidationError("invalid exportArtifact operation: missing 'path'");
      }
      return;
    case "importArtifact":
      if (typeof op.name !== "string" || !op.name) {
        throw new ValidationError("invalid importArtifact operation: missing 'name'");
      }
      if (typeof op.from !== "string" || !op.from) {
        throw new ValidationError("invalid importArtifact operation: missing 'from'");
      }
      if (typeof op.output !== "string" || !op.output) {
        throw new ValidationError("invalid importArtifact operation: missing 'output'");
      }
      return;
    case "diagnostic":
      if (typeof op.message !== "string") {
        throw new ValidationError("invalid diagnostic operation: missing 'message'");
      }
      if (typeof op.severity !== "string" || !SEVERITIES.has(op.severity)) {
        throw new ValidationError("invalid diagnostic operation: missing or invalid 'severity'");
      }
      return;
    // exhaustive
  }
}

function validateDependency(value: unknown): void {
  if (typeof value !== "object" || value === null) {
    throw new ValidationError("invalid dependency: expected object");
  }
  const d = value as Record<string, unknown>;
  if (typeof d.kind !== "string" || !DEPENDENCY_KINDS.has(d.kind)) {
    throw new ValidationError(`invalid dependency: unknown kind '${String(d.kind)}'`);
  }
  if (typeof d.producer !== "string" || !d.producer) {
    throw new ValidationError("invalid dependency: missing 'producer'");
  }
  if (d.kind === "value" || d.kind === "artifact") {
    if (typeof d.output !== "string" || !d.output) {
      throw new ValidationError(`invalid ${d.kind} dependency: missing 'output'`);
    }
  }
}

function validateReference(value: unknown): void {
  if (typeof value !== "object" || value === null) {
    throw new ValidationError("invalid input reference: expected object");
  }
  const r = value as Record<string, unknown>;
  if (typeof r.kind !== "string" || !REFERENCE_KINDS.has(r.kind)) {
    throw new ValidationError(`invalid input reference: unknown kind '${String(r.kind)}'`);
  }
  if (r.kind === "step") {
    if (typeof r.step !== "string" || !r.step) {
      throw new ValidationError("invalid step reference: missing 'step'");
    }
    if (typeof r.output !== "string" || !r.output) {
      throw new ValidationError("invalid step reference: missing 'output'");
    }
    if (typeof r.type !== "string" || !OUTPUT_TYPES.has(r.type)) {
      throw new ValidationError("invalid step reference: missing or invalid 'type'");
    }
    return;
  }
  // context
  if (typeof r.namespace !== "string" || !CONTEXT_NAMESPACES.has(r.namespace)) {
    throw new ValidationError("invalid context reference: missing or invalid 'namespace'");
  }
  if (typeof r.field !== "string" || !r.field) {
    throw new ValidationError("invalid context reference: missing 'field'");
  }
}

function validateOutputDefinition(value: unknown): void {
  if (typeof value !== "object" || value === null) {
    throw new ValidationError("invalid output definition: expected object");
  }
  const o = value as Record<string, unknown>;
  if (typeof o.name !== "string" || !o.name) {
    throw new ValidationError("invalid output definition: missing 'name'");
  }
  if (typeof o.type !== "string" || !OUTPUT_TYPES.has(o.type)) {
    throw new ValidationError("invalid output definition: missing or invalid 'type'");
  }
  if (o.path !== undefined && typeof o.path !== "string") {
    throw new ValidationError("invalid output definition: 'path' must be a string");
  }
  if (o.description !== undefined && typeof o.description !== "string") {
    throw new ValidationError("invalid output definition: 'description' must be a string");
  }
}
