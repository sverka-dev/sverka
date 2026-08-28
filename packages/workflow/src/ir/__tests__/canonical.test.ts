import { describe, it, expect } from "vitest";
import { canonicalStringify } from "../canonical.js";

describe("canonicalStringify", () => {
  it("sorts object keys lexicographically", () => {
    expect(canonicalStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("omits undefined object fields", () => {
    expect(canonicalStringify({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}');
  });

  it("preserves array order", () => {
    expect(canonicalStringify([3, 1, 2])).toBe("[3,1,2]");
  });

  it("emits null for undefined array elements", () => {
    expect(canonicalStringify([1, undefined, 3])).toBe("[1,null,3]");
  });

  it("rejects NaN", () => {
    expect(() => canonicalStringify(NaN)).toThrow(TypeError);
  });

  it("rejects Infinity", () => {
    expect(() => canonicalStringify(Infinity)).toThrow(TypeError);
    expect(() => canonicalStringify(-Infinity)).toThrow(TypeError);
  });

  it("rejects bigint, symbol, and function values", () => {
    expect(() => canonicalStringify(BigInt(1))).toThrow(TypeError);
    expect(() => canonicalStringify(Symbol("x"))).toThrow(TypeError);
    expect(() => canonicalStringify(() => undefined)).toThrow(TypeError);
  });

  it("emits ISO string for Date", () => {
    const d = new Date("2026-01-15T00:00:00.000Z");
    expect(canonicalStringify({ created: d })).toBe('{"created":"2026-01-15T00:00:00.000Z"}');
  });

  it("sorts keys case-sensitively (UTF-16 code-unit order)", () => {
    expect(canonicalStringify({ a: 1, B: 2, A: 3 })).toBe('{"A":3,"B":2,"a":1}');
  });

  it("handles nested objects", () => {
    expect(canonicalStringify({ z: { y: 1, x: 2 } })).toBe('{"z":{"x":2,"y":1}}');
  });

  it("handles null", () => {
    expect(canonicalStringify(null)).toBe("null");
  });

  it("handles booleans", () => {
    expect(canonicalStringify(true)).toBe("true");
    expect(canonicalStringify(false)).toBe("false");
  });

  it("handles strings with special characters", () => {
    expect(canonicalStringify("hello\nworld")).toBe('"hello\\nworld"');
  });
});
