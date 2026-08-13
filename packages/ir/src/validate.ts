// Schema validation for SerializableGraph and RunPlan.
// Spec 06 — Validation. Throws ValidationError on failure.
// Delegates semantic validation to core's validateGraph.

import { validateGraph, type DefinitionGraph } from "@sverka/core";
import { ValidationError } from "./errors.js";
import type { SerializableGraph } from "./serialize.js";
import type { RunPlan, InputValue } from "./run-plan.js";
import { computeGraphId, computeRunPlanId } from "./ids.js";
import { GRAPH_SCHEMA_VERSION, RUN_PLAN_SCHEMA_VERSION } from "./version.js";

const INPUT_TYPES = new Set(["string", "number", "boolean"]);
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
  const v = requireObject(value, "expected an object");
  requireStringField(v, "apiVersion", GRAPH_SCHEMA_VERSION);
  requireString(v, "id", "missing or invalid 'id' field");
  requireString(v, "createdAt", "missing or invalid 'createdAt' field");
  if (typeof v.graph !== "object" || v.graph === null) {
    throw new ValidationError("missing or invalid 'graph' field");
  }
  validateGraphStructure(v.graph as unknown);

  const graph = v.graph as DefinitionGraph;
  validateGraphId(v.id, graph);
  validateGraphSemantics(graph);
}

function validateGraphId(actualId: unknown, graph: DefinitionGraph): void {
  let expectedId: string;
  try {
    expectedId = computeGraphId(graph);
  } catch (err) {
    throw new ValidationError(
      err instanceof Error ? err.message : "failed to compute graph id",
      err,
    );
  }
  if (actualId !== expectedId) {
    throw new ValidationError("graph id does not match content-addressed hash");
  }
}

function validateGraphSemantics(graph: DefinitionGraph): void {
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
  const v = requireObject(value, "expected an object");
  requireStringField(v, "apiVersion", RUN_PLAN_SCHEMA_VERSION);
  requireString(v, "id", "missing or invalid 'id' field");
  requireString(v, "graphId", "missing or invalid 'graphId' field");
  requireString(v, "createdAt", "missing or invalid 'createdAt' field");
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
  validateRunPlanId(value as RunPlan);
}

function validateRunPlanId(plan: RunPlan): void {
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

// ── Shared validation helpers ──────────────────────────────────────

function requireObject(value: unknown, msg: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new ValidationError(msg);
  }
  return value as Record<string, unknown>;
}

function requireString(v: Record<string, unknown>, field: string, msg: string): void {
  if (typeof v[field] !== "string") {
    throw new ValidationError(msg);
  }
}

function requireStringField(v: Record<string, unknown>, field: string, expected: string): void {
  if (v[field] !== expected) {
    throw new ValidationError(`expected ${field} '${expected}', got '${String(v[field])}'`);
  }
}

function requireNonEmptyString(v: Record<string, unknown>, field: string, msg: string): void {
  if (typeof v[field] !== "string" || !v[field]) {
    throw new ValidationError(msg);
  }
}

function requireArray(v: Record<string, unknown>, field: string, msg: string): unknown[] {
  if (!Array.isArray(v[field])) {
    throw new ValidationError(msg);
  }
  return v[field] as unknown[];
}

function validateInputs(inputs: Record<string, unknown>): void {
  for (const [key, val] of Object.entries(inputs)) {
    validateInputValue(val, key);
  }
}

function validateInputValue(value: unknown, name: string): asserts value is InputValue {
  if (value === null || value === undefined) {
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
  const g = requireObject(value, "invalid graph: expected object");
  if (typeof g.project !== "object" || g.project === null) {
    throw new ValidationError("invalid graph: missing 'project'");
  }
  const p = g.project as Record<string, unknown>;
  requireString(p, "id", "invalid graph: project missing 'id'");
  for (const pipeline of requireArray(p, "pipelines", "invalid graph: project missing 'pipelines' array")) {
    validatePipelineStructure(pipeline);
  }
}

function validatePipelineStructure(value: unknown): void {
  const p = requireObject(value, "invalid pipeline: expected object");
  requireNonEmptyString(p, "id", "invalid pipeline: missing 'id'");
  if (typeof p.inputs !== "object" || p.inputs === null || Array.isArray(p.inputs)) {
    throw new ValidationError("invalid pipeline: missing 'inputs' object");
  }
  for (const [name, input] of Object.entries(p.inputs as Record<string, unknown>)) {
    validatePipelineInput(name, input);
  }
  for (const entry of requireArray(p, "entries", "invalid pipeline: missing 'entries' array")) {
    validateEntryDefinition(entry);
  }
  requireArray(p, "steps", "invalid pipeline: missing 'steps' array");
  requireArray(p, "outputs", "invalid pipeline: missing 'outputs' array");
  for (const step of p.steps as unknown[]) {
    validateStepStructure(step);
  }
}

function validatePipelineInput(name: string, value: unknown): void {
  if (typeof value !== "object" || value === null) {
    throw new ValidationError(`invalid pipeline input "${name}": expected object`);
  }
  const i = value as Record<string, unknown>;
  if (typeof i.type !== "string" || !INPUT_TYPES.has(i.type)) {
    throw new ValidationError(`invalid pipeline input "${name}": missing or invalid 'type'`);
  }
  const type = i.type;
  if (i.required !== undefined && typeof i.required !== "boolean") {
    throw new ValidationError(`invalid pipeline input "${name}": 'required' must be a boolean`);
  }
  if (i.secret !== undefined && typeof i.secret !== "boolean") {
    throw new ValidationError(`invalid pipeline input "${name}": 'secret' must be a boolean`);
  }
  if (i.description !== undefined && typeof i.description !== "string") {
    throw new ValidationError(`invalid pipeline input "${name}": 'description' must be a string`);
  }
  if (i.default !== undefined && typeof i.default !== type) {
    throw new ValidationError(
      `invalid pipeline input "${name}": 'default' does not match declared type "${type}"`,
    );
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
  const s = requireObject(value, "invalid step: expected object");
  requireNonEmptyString(s, "id", "invalid step: missing 'id'");
  if (typeof s.runtime !== "object" || s.runtime === null) {
    throw new ValidationError("invalid step: missing 'runtime'");
  }
  validateStepArrays(s);
}

function validateStepArrays(s: Record<string, unknown>): void {
  for (const op of requireArray(s, "operations", "invalid step: missing 'operations' array")) {
    validateOperation(op);
  }
  for (const input of requireArray(s, "inputs", "invalid step: missing 'inputs' array")) {
    validateReference(input);
  }
  for (const output of requireArray(s, "outputs", "invalid step: missing 'outputs' array")) {
    validateOutputDefinition(output);
  }
  for (const dep of requireArray(s, "dependencies", "invalid step: missing 'dependencies' array")) {
    validateDependency(dep);
  }
}

function validateOperation(value: unknown): void {
  const op = requireObject(value, "invalid operation: expected object");
  if (typeof op.kind !== "string" || !OPERATION_KINDS.has(op.kind)) {
    throw new ValidationError(`invalid operation: unknown kind '${String(op.kind)}'`);
  }
  const validators: Record<string, (op: Record<string, unknown>) => void> = {
    shell: validateShellOp,
    exportOutput: validateExportOutputOp,
    exportArtifact: validateExportArtifactOp,
    importArtifact: validateImportArtifactOp,
    diagnostic: validateDiagnosticOp,
  };
  validators[op.kind]!(op);
}

function validateShellOp(op: Record<string, unknown>): void {
  if (typeof op.command !== "string") {
    throw new ValidationError("invalid shell operation: missing 'command'");
  }
}

function validateExportOutputOp(op: Record<string, unknown>): void {
  requireNonEmptyString(op, "name", "invalid exportOutput operation: missing 'name'");
  if (typeof op.type !== "string" || !OUTPUT_TYPES.has(op.type)) {
    throw new ValidationError("invalid exportOutput operation: missing or invalid 'type'");
  }
}

function validateExportArtifactOp(op: Record<string, unknown>): void {
  requireNonEmptyString(op, "name", "invalid exportArtifact operation: missing 'name'");
  requireNonEmptyString(op, "path", "invalid exportArtifact operation: missing 'path'");
}

function validateImportArtifactOp(op: Record<string, unknown>): void {
  requireNonEmptyString(op, "name", "invalid importArtifact operation: missing 'name'");
  requireNonEmptyString(op, "from", "invalid importArtifact operation: missing 'from'");
  requireNonEmptyString(op, "output", "invalid importArtifact operation: missing 'output'");
}

function validateDiagnosticOp(op: Record<string, unknown>): void {
  if (typeof op.message !== "string") {
    throw new ValidationError("invalid diagnostic operation: missing 'message'");
  }
  if (typeof op.severity !== "string" || !SEVERITIES.has(op.severity)) {
    throw new ValidationError("invalid diagnostic operation: missing or invalid 'severity'");
  }
}

function validateDependency(value: unknown): void {
  const d = requireObject(value, "invalid dependency: expected object");
  if (typeof d.kind !== "string" || !DEPENDENCY_KINDS.has(d.kind)) {
    throw new ValidationError(`invalid dependency: unknown kind '${String(d.kind)}'`);
  }
  requireNonEmptyString(d, "producer", "invalid dependency: missing 'producer'");
  if ((d.kind === "value" || d.kind === "artifact") && (typeof d.output !== "string" || !d.output)) {
    throw new ValidationError(`invalid ${d.kind} dependency: missing 'output'`);
  }
}

function validateReference(value: unknown): void {
  const r = requireObject(value, "invalid input reference: expected object");
  if (typeof r.kind !== "string" || !REFERENCE_KINDS.has(r.kind)) {
    throw new ValidationError(`invalid input reference: unknown kind '${String(r.kind)}'`);
  }
  if (r.kind === "step") {
    validateStepReference(r);
    return;
  }
  validateContextReference(r);
}

function validateStepReference(r: Record<string, unknown>): void {
  requireNonEmptyString(r, "step", "invalid step reference: missing 'step'");
  requireNonEmptyString(r, "output", "invalid step reference: missing 'output'");
  if (typeof r.type !== "string" || !OUTPUT_TYPES.has(r.type)) {
    throw new ValidationError("invalid step reference: missing or invalid 'type'");
  }
}

function validateContextReference(r: Record<string, unknown>): void {
  if (typeof r.namespace !== "string" || !CONTEXT_NAMESPACES.has(r.namespace)) {
    throw new ValidationError("invalid context reference: missing or invalid 'namespace'");
  }
  requireNonEmptyString(r, "field", "invalid context reference: missing 'field'");
}

function validateOutputDefinition(value: unknown): void {
  const o = requireObject(value, "invalid output definition: expected object");
  requireNonEmptyString(o, "name", "invalid output definition: missing 'name'");
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
