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
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new StorageError("CORRUPT_SNAPSHOT", "snapshot is not valid JSON", e);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new StorageError("CORRUPT_SNAPSHOT", "snapshot is not an object");
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj["runId"] !== "string") {
    throw new StorageError("CORRUPT_SNAPSHOT", "missing or invalid field: runId");
  }
  if (obj["runId"] !== runId) {
    throw new StorageError(
      "CORRUPT_SNAPSHOT",
      `snapshot runId "${obj["runId"]}" does not match requested runId "${runId}"`,
    );
  }
  if (typeof obj["planId"] !== "string") {
    throw new StorageError("CORRUPT_SNAPSHOT", "missing or invalid field: planId");
  }
  if (typeof obj["plan"] !== "object" || obj["plan"] === null) {
    throw new StorageError("CORRUPT_SNAPSHOT", "missing or invalid field: plan");
  }
  if (!Array.isArray(obj["completedSteps"])) {
    throw new StorageError("CORRUPT_SNAPSHOT", "missing or invalid field: completedSteps");
  }
  for (let i = 0; i < obj["completedSteps"].length; i++) {
    const entry = (obj["completedSteps"] as unknown[])[i];
    if (typeof entry !== "object" || entry === null) {
      throw new StorageError("CORRUPT_SNAPSHOT", `completedSteps[${i}] is not an object`);
    }
    const step = entry as Record<string, unknown>;
    if (typeof step["stepId"] !== "string") {
      throw new StorageError("CORRUPT_SNAPSHOT", `completedSteps[${i}].stepId is missing or not a string`);
    }
    if (typeof step["outputs"] !== "object" || step["outputs"] === null) {
      throw new StorageError("CORRUPT_SNAPSHOT", `completedSteps[${i}].outputs is missing or not an object`);
    }
  }
  if (typeof obj["suspendedStepId"] !== "string") {
    throw new StorageError("CORRUPT_SNAPSHOT", "missing or invalid field: suspendedStepId");
  }
  if (obj["status"] !== "suspended") {
    throw new StorageError("CORRUPT_SNAPSHOT", `expected status "suspended", got "${String(obj["status"])}"`);
  }
  if (typeof obj["suspendedAt"] !== "number") {
    throw new StorageError("CORRUPT_SNAPSHOT", "missing or invalid field: suspendedAt");
  }
  if (obj["resumeSchema"] !== undefined) {
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

  return parsed as RunSnapshot;
}
