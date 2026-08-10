import { describe, it, expect } from "vitest";
import { canonicalJson } from "../internal/canonical.js";

describe("canonicalJson", () => {
  it("sorts object keys lexicographically", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("omits undefined values from objects", () => {
    expect(canonicalJson({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}');
  });

  it("omits undefined values from arrays", () => {
    expect(canonicalJson([1, undefined, 3])).toBe("[1,3]");
  });

  it("preserves array order", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("handles nested objects with sorted keys", () => {
    expect(canonicalJson({ z: { y: 1, x: 2 } })).toBe('{"z":{"x":2,"y":1}}');
  });

  it("handles primitives", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson(42)).toBe("42");
    expect(canonicalJson("hello")).toBe('"hello"');
  });

  it("serializes NaN and Infinity as null", () => {
    expect(canonicalJson(NaN)).toBe("null");
    expect(canonicalJson(Infinity)).toBe("null");
  });

  it("produces compact output (no spaces)", () => {
    expect(canonicalJson({ a: { b: 1 } })).toBe('{"a":{"b":1}}');
  });
});
