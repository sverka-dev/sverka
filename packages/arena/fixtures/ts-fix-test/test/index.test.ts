import { describe, it, expect } from "bun:test";
import { capitalize, reverse, countUniqueWords, truncate } from "../src/index";

describe("capitalize", () => {
  it("capitalizes first letter", () => {
    expect(capitalize("hello")).toBe("Hello");
  });
  it("handles empty string", () => {
    expect(capitalize("")).toBe("");
  });
});

describe("reverse", () => {
  it("reverses a string", () => {
    expect(reverse("abc")).toBe("cba");
  });
});

describe("countUniqueWords", () => {
  it("counts unique words case-insensitively", () => {
    expect(countUniqueWords("hello world hello")).toBe(2);
  });
  it("handles single word", () => {
    expect(countUniqueWords("hello")).toBe(1);
  });
  it("handles empty string", () => {
    expect(countUniqueWords("")).toBe(0);
  });
});

describe("truncate", () => {
  it("truncates long strings with ellipsis", () => {
    expect(truncate("hello world", 8)).toBe("hello...");
  });
  it("does not truncate short strings", () => {
    expect(truncate("hi", 10)).toBe("hi");
  });
});
