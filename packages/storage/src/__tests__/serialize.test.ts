// Spec 31 — serialize/deserialize tests.
import { describe, it, expect } from "vitest";
import { serialize, deserialize } from "../internal/serialize.js";
import { StorageError } from "../errors.js";
import { makeSnapshot } from "./helpers/fixtures.js";

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
    const snap = makeSnapshot();
    const text = serialize(snap).replace('"runId"', '"xrunId"');
    expect(() => deserialize(text, "run-1")).toThrow(StorageError);
  });

  it("deserialize throws CORRUPT_SNAPSHOT when planId is missing", () => {
    const snap = makeSnapshot();
    const text = serialize(snap).replace('"planId"', '"xplanId"');
    expect(() => deserialize(text, "run-1")).toThrow(StorageError);
  });

  it("deserialize throws CORRUPT_SNAPSHOT when suspendedStepId is missing", () => {
    const snap = makeSnapshot();
    const text = serialize(snap).replace('"suspendedStepId"', '"xsuspendedStepId"');
    expect(() => deserialize(text, "run-1")).toThrow(StorageError);
  });

  it("deserialize throws CORRUPT_SNAPSHOT when completedSteps is missing", () => {
    const snap = makeSnapshot();
    const text = serialize(snap).replace('"completedSteps"', '"xcompletedSteps"');
    expect(() => deserialize(text, "run-1")).toThrow(StorageError);
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
    const snap = makeSnapshot();
    const obj = JSON.parse(serialize(snap));
    obj.completedSteps[0] = null;
    const text = JSON.stringify(obj);
    expect(() => deserialize(text, "run-1")).toThrow(StorageError);
  });

  it("deserialize throws CORRUPT_SNAPSHOT when completedSteps entry has no stepId", () => {
    const snap = makeSnapshot();
    const obj = JSON.parse(serialize(snap));
    delete obj.completedSteps[0].stepId;
    const text = JSON.stringify(obj);
    expect(() => deserialize(text, "run-1")).toThrow(StorageError);
  });

  it("deserialize throws CORRUPT_SNAPSHOT when completedSteps entry has no outputs", () => {
    const snap = makeSnapshot();
    const obj = JSON.parse(serialize(snap));
    delete obj.completedSteps[0].outputs;
    const text = JSON.stringify(obj);
    expect(() => deserialize(text, "run-1")).toThrow(StorageError);
  });

  it("deserialize throws CORRUPT_SNAPSHOT when resumeSchema is not an object", () => {
    const snap = makeSnapshot();
    const obj = JSON.parse(serialize(snap));
    obj.resumeSchema = "bad";
    const text = JSON.stringify(obj);
    expect(() => deserialize(text, "run-1")).toThrow(StorageError);
  });

  it("deserialize throws CORRUPT_SNAPSHOT when resumeSchema.required is not string array", () => {
    const snap = makeSnapshot();
    const obj = JSON.parse(serialize(snap));
    obj.resumeSchema.required = [123];
    const text = JSON.stringify(obj);
    expect(() => deserialize(text, "run-1")).toThrow(StorageError);
  });

  it("deserialize accepts snapshot without resumeSchema", () => {
    const snap = makeSnapshot();
    const obj = JSON.parse(serialize(snap));
    delete obj.resumeSchema;
    const text = JSON.stringify(obj);
    const restored = deserialize(text, "run-1");
    expect(restored.runId).toBe("run-1");
    expect(restored.resumeSchema).toBeUndefined();
  });
});
