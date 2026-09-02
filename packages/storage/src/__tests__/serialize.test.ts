// Spec 31 — serialize/deserialize tests.
import { describe, it, expect } from "vitest";
import { serialize, deserialize } from "../internal/serialize.js";
import { StorageError } from "../errors.js";
import { makeSnapshot } from "./helpers/fixtures.js";

/** Serialize a snapshot, apply a mutation to the JSON, then expect deserialization to throw CORRUPT_SNAPSHOT. */
function expectCorruptSnapshot(mutate: (obj: Record<string, unknown>) => void, runId = "run-1"): void {
  const snap = makeSnapshot();
  const parsed: unknown = JSON.parse(serialize(snap));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("serialized snapshot must be a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  mutate(obj);
  const text = JSON.stringify(obj);
  expect(() => deserialize(text, runId)).toThrowError(expect.objectContaining({ code: "CORRUPT_SNAPSHOT" }));
}

/** Serialize a snapshot, rename a field in the JSON string, then expect deserialization to throw CORRUPT_SNAPSHOT. */
function expectCorruptByFieldRename(field: string): void {
  const snap = makeSnapshot();
  const text = serialize(snap).replace(`"${field}"`, `"x${field}"`);
  expect(() => deserialize(text, "run-1")).toThrowError(expect.objectContaining({ code: "CORRUPT_SNAPSHOT" }));
}

describe("serialize / deserialize", () => {
  it("round-trips a snapshot (JSON-serializable fields preserved)", () => {
    const snap = makeSnapshot("run-rt");
    const text = serialize(snap);
    const restored = deserialize(text, "run-rt");
    expect(restored).toEqual(snap);
  });

  it("serialize produces pretty-printed JSON (2-space indent)", () => {
    const snap = makeSnapshot();
    const text = serialize(snap);
    expect(text).toContain('\n  "runId"');
  });

  it("deserialize throws StorageError(CORRUPT_SNAPSHOT) for invalid JSON", () => {
    expect(() => deserialize("{ not valid json", "run-1")).toThrow(StorageError);
    try {
      deserialize("{ not valid json", "run-1");
    } catch (e) {
      const err = e as StorageError;
      expect(err.code).toBe("CORRUPT_SNAPSHOT");
    }
  });

  it("deserialize throws CORRUPT_SNAPSHOT when runId is missing", () => {
    expectCorruptByFieldRename("runId");
  });

  it("deserialize throws CORRUPT_SNAPSHOT when planId is missing", () => {
    expectCorruptByFieldRename("planId");
  });

  it("deserialize throws CORRUPT_SNAPSHOT when suspendedStepId is missing", () => {
    expectCorruptByFieldRename("suspendedStepId");
  });

  it("deserialize throws CORRUPT_SNAPSHOT when completedSteps is missing", () => {
    expectCorruptByFieldRename("completedSteps");
  });

  it("deserialize throws CORRUPT_SNAPSHOT when status !== suspended", () => {
    const snap = makeSnapshot();
    const text = serialize(snap).replace('"suspended"', '"success"');
    expect(() => deserialize(text, "run-1")).toThrow(StorageError);
  });

  it("deserialize throws CORRUPT_SNAPSHOT when runId does not match requested runId", () => {
    const snap = makeSnapshot("run-a");
    const text = serialize(snap);
    expect(() => deserialize(text, "run-b")).toThrow(StorageError);
    try {
      deserialize(text, "run-b");
    } catch (e) {
      expect((e as StorageError).code).toBe("CORRUPT_SNAPSHOT");
    }
  });

  it("deserialize throws CORRUPT_SNAPSHOT when completedSteps entry is not an object", () => {
    expectCorruptSnapshot((obj) => { (obj.completedSteps as unknown[])[0] = null; });
  });

  it("deserialize throws CORRUPT_SNAPSHOT when completedSteps entry has no stepId", () => {
    expectCorruptSnapshot((obj) => { delete (obj.completedSteps as Record<string, unknown>[])[0]!.stepId; });
  });

  it("deserialize throws CORRUPT_SNAPSHOT when completedSteps entry has no outputs", () => {
    expectCorruptSnapshot((obj) => { delete (obj.completedSteps as Record<string, unknown>[])[0]!.outputs; });
  });

  it("deserialize throws CORRUPT_SNAPSHOT when resumeSchema is not an object", () => {
    expectCorruptSnapshot((obj) => { obj.resumeSchema = "bad"; });
  });

  it("deserialize throws CORRUPT_SNAPSHOT when resumeSchema.required is not string array", () => {
    expectCorruptSnapshot((obj) => { ((obj.resumeSchema as Record<string, unknown>).required as unknown[])[0] = 123; });
  });

  it("deserialize accepts snapshot without resumeSchema", () => {
    const snap = makeSnapshot();
    const parsed: unknown = JSON.parse(serialize(snap));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("serialized snapshot must be a JSON object");
    }
    const obj = parsed as Record<string, unknown>;
    delete obj.resumeSchema;
    const text = JSON.stringify(obj);
    const restored = deserialize(text, "run-1");
    expect(restored.runId).toBe("run-1");
    expect(restored.resumeSchema).toBeUndefined();
  });
});
