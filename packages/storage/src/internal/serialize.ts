// serialize / deserialize — JSON round-trip + validation for RunSnapshot.
// Spec 31 — Serialization.

import type { RunSnapshot } from "@sverka/runtime";
import { StorageError } from "../errors.js";

/** Serialize a RunSnapshot to pretty-printed JSON (2-space indent). */
export function serialize(snapshot: RunSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

/**
 * Deserialize a JSON string into a RunSnapshot, validating required fields.
 * Throws StorageError(CORRUPT_SNAPSHOT) on parse failure or shape mismatch.
 */
export function deserialize(text: string, runId: string): RunSnapshot {
  const parsed = parseJson(text);
  if (typeof parsed !== "object" || parsed === null) {
    throw new StorageError("CORRUPT_SNAPSHOT", "snapshot is not an object");
  }
  const obj = parsed as Record<string, unknown>;
  validateScalarFields(obj, runId);
  validateCompletedSteps(obj);
  validateResumeSchema(obj);
  return parsed as RunSnapshot;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new StorageError("CORRUPT_SNAPSHOT", "snapshot is not valid JSON", e);
  }
}

function validateScalarFields(obj: Record<string, unknown>, runId: string): void {
  validateStringField(obj, "runId");
  if (obj["runId"] !== runId) {
    throw new StorageError(
      "CORRUPT_SNAPSHOT",
      `snapshot runId "${obj["runId"]}" does not match requested runId "${runId}"`,
    );
  }
  validateStringField(obj, "planId");
  validatePlanField(obj);
  if (!Array.isArray(obj["completedSteps"])) {
    throw new StorageError("CORRUPT_SNAPSHOT", "missing or invalid field: completedSteps");
  }
  validateStringField(obj, "suspendedStepId");
  if (obj["status"] !== "suspended") {
    throw new StorageError("CORRUPT_SNAPSHOT", `expected status "suspended", got "${String(obj["status"])}"`);
  }
  if (typeof obj["suspendedAt"] !== "number") {
    throw new StorageError("CORRUPT_SNAPSHOT", "missing or invalid field: suspendedAt");
  }
}

function validateStringField(obj: Record<string, unknown>, field: string): void {
  if (typeof obj[field] !== "string") {
    throw new StorageError("CORRUPT_SNAPSHOT", `missing or invalid field: ${field}`);
  }
}

function validatePlanField(obj: Record<string, unknown>): void {
  if (typeof obj["plan"] !== "object" || obj["plan"] === null || Array.isArray(obj["plan"])) {
    throw new StorageError("CORRUPT_SNAPSHOT", "missing or invalid field: plan");
  }
}

function validateCompletedSteps(obj: Record<string, unknown>): void {
  const steps = obj["completedSteps"] as unknown[];
  for (let i = 0; i < steps.length; i++) {
    const entry = steps[i];
    if (typeof entry !== "object" || entry === null) {
      throw new StorageError("CORRUPT_SNAPSHOT", `completedSteps[${i}] is not an object`);
    }
    const step = entry as Record<string, unknown>;
    if (typeof step["stepId"] !== "string") {
      throw new StorageError("CORRUPT_SNAPSHOT", `completedSteps[${i}].stepId is missing or not a string`);
    }
    if (typeof step["outputs"] !== "object" || step["outputs"] === null || Array.isArray(step["outputs"])) {
      throw new StorageError("CORRUPT_SNAPSHOT", `completedSteps[${i}].outputs is missing or not an object`);
    }
  }
}

function validateResumeSchema(obj: Record<string, unknown>): void {
  if (obj["resumeSchema"] === undefined) return;
  if (typeof obj["resumeSchema"] !== "object" || obj["resumeSchema"] === null) {
    throw new StorageError("CORRUPT_SNAPSHOT", "resumeSchema is not an object");
  }
  const rs = obj["resumeSchema"] as Record<string, unknown>;
  if (rs["required"] !== undefined) {
    if (!Array.isArray(rs["required"]) || !rs["required"].every((v) => typeof v === "string")) {
      throw new StorageError("CORRUPT_SNAPSHOT", "resumeSchema.required is not an array of strings");
    }
  }
}
