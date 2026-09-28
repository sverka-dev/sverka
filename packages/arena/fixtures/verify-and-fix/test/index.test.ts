import { describe, it, expect } from "bun:test";
import { slugify, parseVersion, countVowels } from "../src/index";

describe("slugify", () => {
  it("converts to a lowercase slug", () => {
    expect(slugify("Hello World!")).toBe("hello-world");
  });
});

describe("parseVersion", () => {
  it("returns the major version number", () => {
    expect(parseVersion("1.2.3")).toBe(1);
  });
});

describe("countVowels", () => {
  it("counts vowels case-insensitively", () => {
    expect(countVowels("APPLE")).toBe(2);
  });
  it("returns zero for no vowels", () => {
    expect(countVowels("xyz")).toBe(0);
  });
});
