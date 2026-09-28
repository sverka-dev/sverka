import { describe, it, expect } from "bun:test";
import { add } from "../src/index";

describe("add", () => {
  it("adds two numbers", () => {
    expect(add(2, 3)).toBe(5);
  });
});
