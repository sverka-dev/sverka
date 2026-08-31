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
export function deserialize(text: string, _runId: string): RunSnapshot {
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
  if (typeof obj["planId"] !== "string") {
    throw new StorageError("CORRUPT_SNAPSHOT", "missing or invalid field: planId");
  }
  if (typeof obj["plan"] !== "object" || obj["plan"] === null) {
    throw new StorageError("CORRUPT_SNAPSHOT", "missing or invalid field: plan");
  }
  if (!Array.isArray(obj["completedSteps"])) {
    throw new StorageError("CORRUPT_SNAPSHOT", "missing or invalid field: completedSteps");
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

  return parsed as RunSnapshot;
}
