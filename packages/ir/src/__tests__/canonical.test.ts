import { describe, it, expect } from "vitest";
import { canonicalStringify } from "../internal/canonical.js";

describe("canonicalStringify", () => {
  it("is key-order independent for objects", () => {
    const a = { z: 1, a: 2, m: 3 };
    const b = { a: 2, m: 3, z: 1 };
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  it("sorts keys lexicographically (byte-wise on UTF-16 code units)", () => {
    expect(canonicalStringify({ b: 1, a: 2, c: 3 })).toBe(
      canonicalStringify({ a: 2, b: 1, c: 3 }),
    );
    // byte-wise: uppercase before lowercase (A=0x41 < a=0x61)
    expect(canonicalStringify({ A: 1, a: 2 })).toBe(
      canonicalStringify({ a: 2, A: 1 }),
    );
    const out = canonicalStringify({ a: 2, A: 1 });
    expect(out.indexOf('"A"')).toBeLessThan(out.indexOf('"a"'));
  });

  it("preserves array element order", () => {
    expect(canonicalStringify([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalStringify(["c", "a", "b"])).toBe('["c","a","b"]');
  });

  it("is compact (no whitespace)", () => {
    expect(canonicalStringify({ a: 1, b: 2 })).toBe('{"a":1,"b":2}');
    expect(canonicalStringify({ a: [1, 2], b: { c: 3 } })).toBe(
      '{"a":[1,2],"b":{"c":3}}',
    );
  });

  it("omits undefined fields from objects", () => {
    const out = canonicalStringify({ a: 1, b: undefined, c: 3 });
    expect(out).toBe('{"a":1,"c":3}');
  });

  it("handles nested objects with sorted keys at every level", () => {
    const a = { outer: { z: 1, a: 2 }, list: [{ b: 2, a: 1 }] };
    const b = { list: [{ a: 1, b: 2 }], outer: { a: 2, z: 1 } };
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  it("handles strings, numbers, booleans, null", () => {
    expect(canonicalStringify("hi")).toBe('"hi"');
    expect(canonicalStringify(42)).toBe("42");
    expect(canonicalStringify(true)).toBe("true");
    expect(canonicalStringify(null)).toBe("null");
  });

  it("escapes strings per JSON", () => {
    expect(canonicalStringify('a"b\\c\n')).toBe('"a\\"b\\\\c\\n"');
  });

  it("is byte-stable across calls (deterministic)", () => {
    const obj = { ops: [{ id: "op-1", kind: "run" }], name: "ci" };
    const first = canonicalStringify(obj);
    for (let i = 0; i < 5; i++) {
      expect(canonicalStringify(obj)).toBe(first);
    }
  });

  it("throws on NaN and Infinity (not valid JSON)", () => {
    expect(() => canonicalStringify(NaN)).toThrow();
    expect(() => canonicalStringify(Infinity)).toThrow();
    expect(() => canonicalStringify({ x: -Infinity })).toThrow();
  });

  it("handles empty objects and arrays", () => {
    expect(canonicalStringify({})).toBe("{}");
    expect(canonicalStringify([])).toBe("[]");
  });
});
