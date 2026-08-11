import { describe, it, expect } from "vitest";
import { canonicalStringify } from "../internal/canonical.js";

describe("canonicalStringify", () => {
  it("sorts object keys lexicographically", () => {
    expect(canonicalStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("sorts keys by UTF-16 code unit, so uppercase precedes lowercase", () => {
    expect(canonicalStringify({ a: 1, B: 2, A: 3 })).toBe('{"A":3,"B":2,"a":1}');
  });

  it("omits undefined values from objects", () => {
    expect(canonicalStringify({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}');
  });

  it("emits null for undefined values in arrays", () => {
    expect(canonicalStringify([1, undefined, 3])).toBe("[1,null,3]");
  });

  it("preserves array order", () => {
    expect(canonicalStringify([3, 1, 2])).toBe("[3,1,2]");
  });

  it("handles nested objects with sorted keys", () => {
    expect(canonicalStringify({ z: { y: 1, x: 2 } })).toBe('{"z":{"x":2,"y":1}}');
  });

  it("handles primitives", () => {
    expect(canonicalStringify(null)).toBe("null");
    expect(canonicalStringify(true)).toBe("true");
    expect(canonicalStringify(42)).toBe("42");
    expect(canonicalStringify("hello")).toBe('"hello"');
  });

  it("rejects NaN and Infinity (not valid JSON)", () => {
    expect(() => canonicalStringify(NaN)).toThrow(TypeError);
    expect(() => canonicalStringify(Infinity)).toThrow(TypeError);
  });

  it("produces compact output (no spaces)", () => {
    expect(canonicalStringify({ a: { b: 1 } })).toBe('{"a":{"b":1}}');
  });

  it("serializes top-level undefined as null", () => {
    expect(canonicalStringify(undefined)).toBe("null");
  });

  it("serializes Date instances as ISO strings", () => {
    expect(canonicalStringify({ created: new Date("2026-01-15T00:00:00.000Z") })).toBe(
      '{"created":"2026-01-15T00:00:00.000Z"}',
    );
  });
});
