import { describe, it, expect } from "vitest";
import { parseCpu, parseMemory } from "../internal/parse.js";

describe("parseCpu", () => {
  it("parses an integer cpu string", () => {
    expect(parseCpu("2")).toBe(2);
  });

  it("parses a fractional cpu string", () => {
    expect(parseCpu("0.5")).toBe(0.5);
    expect(parseCpu("1.5")).toBe(1.5);
  });

  it("rejects non-positive values", () => {
    expect(() => parseCpu("0")).toThrow(RangeError);
    expect(() => parseCpu("-1")).toThrow(RangeError);
  });

  it("rejects non-numeric strings", () => {
    expect(() => parseCpu("abc")).toThrow(RangeError);
    expect(() => parseCpu("")).toThrow(RangeError);
  });
});

describe("parseMemory", () => {
  it("parses a bare number as bytes", () => {
    expect(parseMemory("512")).toBe(512);
  });

  it("parses binary suffixes", () => {
    expect(parseMemory("512Ki")).toBe(512 * 1024);
    expect(parseMemory("1Mi")).toBe(1024 ** 2);
    expect(parseMemory("2Gi")).toBe(2 * 1024 ** 3);
    expect(parseMemory("1Ti")).toBe(1024 ** 4);
  });

  it("rejects malformed memory strings", () => {
    expect(() => parseMemory("abc")).toThrow(RangeError);
    expect(() => parseMemory("1.5Gi")).toThrow(RangeError);
    expect(() => parseMemory("")).toThrow(RangeError);
    expect(() => parseMemory("1Xi")).toThrow(RangeError);
  });
});
