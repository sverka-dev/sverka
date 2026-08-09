import { describe, it, expect } from "vitest";
import { serializePlan, deserializePlan } from "../serialize.js";
import { SerializationError, ValidationError } from "../errors.js";
import { validPlan, twoOpPlan, dockerOperation } from "./helpers/fixtures.js";

describe("serializePlan", () => {
  it("produces a canonical JSON string", () => {
    const out = serializePlan(validPlan());
    expect(typeof out).toBe("string");
    expect(out.startsWith("{")).toBe(true);
    // compact: no whitespace between tokens
    expect(out).not.toMatch(/,\s/);
    expect(out).not.toMatch(/:\s/);
  });

  it("two identical plans produce byte-identical output", () => {
    const a = validPlan();
    const b = validPlan();
    expect(serializePlan(a)).toBe(serializePlan(b));
  });

  it("is key-order independent", () => {
    // Rebuild a plan with metadata/operations swapped in key order.
    const plan = validPlan();
    const reordered = {
      metadata: plan.metadata,
      operations: plan.operations,
      sourceContextHash: plan.sourceContextHash,
      name: plan.name,
      createdAt: plan.createdAt,
      id: plan.id,
      apiVersion: plan.apiVersion,
    };
    expect(serializePlan(reordered)).toBe(serializePlan(plan));
  });

  it("sorts keys lexicographically at every level", () => {
    const out = serializePlan(validPlan());
    // "apiVersion" < "createdAt" < "id" < "metadata" < "name" < "operations"
    const apiIdx = out.indexOf('"apiVersion"');
    const createdIdx = out.indexOf('"createdAt"');
    const idIdx = out.indexOf('"id"');
    const metaIdx = out.indexOf('"metadata"');
    const nameIdx = out.indexOf('"name"');
    const opsIdx = out.indexOf('"operations"');
    expect(apiIdx).toBeLessThan(createdIdx);
    expect(createdIdx).toBeLessThan(idIdx);
    expect(idIdx).toBeLessThan(metaIdx);
    expect(metaIdx).toBeLessThan(nameIdx);
    expect(nameIdx).toBeLessThan(opsIdx);
  });

  it("preserves operation array order", () => {
    const plan = twoOpPlan();
    const out = serializePlan(plan);
    expect(out.indexOf('"op-a"')).toBeLessThan(out.indexOf('"op-b"'));
  });

  it("omits undefined optional fields", () => {
    const plan = validPlan({ operations: [dockerOperation()] });
    const out = serializePlan(plan);
    // dockerOperation has no `condition` or `cache` or `compiler` → those
    // keys must not appear.
    expect(out).not.toContain('"condition"');
    expect(out).not.toContain('"cache"');
    expect(out).not.toContain('"compiler"');
  });
});

describe("deserializePlan", () => {
  it("round-trips a plan losslessly", () => {
    const original = validPlan();
    const json = serializePlan(original);
    const restored = deserializePlan(json);
    expect(restored).toEqual(original);
  });

  it("round-trips a two-operation plan", () => {
    const original = twoOpPlan();
    const restored = deserializePlan(serializePlan(original));
    expect(restored).toEqual(original);
  });

  it("returns a deep-frozen object (readonly enforced at runtime)", () => {
    const restored = deserializePlan(serializePlan(validPlan()));
    expect(Object.isFrozen(restored)).toBe(true);
    expect(Object.isFrozen(restored.operations)).toBe(true);
    expect(Object.isFrozen(restored.operations[0])).toBe(true);
    expect(Object.isFrozen(restored.metadata)).toBe(true);
    expect(() => {
      (restored as { name: string }).name = "mutated";
    }).toThrow(TypeError);
  });

  it("throws SerializationError on malformed JSON", () => {
    expect(() => deserializePlan("{not json")).toThrow(SerializationError);
    expect(() => deserializePlan("")).toThrow(SerializationError);
    expect(() => deserializePlan("{")).toThrow(SerializationError);
  });

  it("throws ValidationError on valid JSON that is not a plan object", () => {
    // null and primitives are valid JSON but fail schema validation.
    expect(() => deserializePlan("null")).toThrow(ValidationError);
    expect(() => deserializePlan("42")).toThrow(ValidationError);
    expect(() => deserializePlan('"string"')).toThrow(ValidationError);
    expect(() => deserializePlan("[]")).toThrow(ValidationError);
  });

  it("throws ValidationError on a structurally valid but schema-invalid object", () => {
    const plan = serializePlan(validPlan());
    const bad = JSON.parse(plan) as Record<string, unknown>;
    bad.apiVersion = "sverka.dev/v2";
    expect(() => deserializePlan(JSON.stringify(bad))).toThrow(ValidationError);
  });

  it("throws ValidationError when the id does not match", () => {
    const plan = serializePlan(validPlan());
    const bad = JSON.parse(plan) as Record<string, unknown>;
    bad.id = "plan-wrong";
    expect(() => deserializePlan(JSON.stringify(bad))).toThrow(ValidationError);
  });
});
