import { describe, it, expect } from "bun:test";
import { greet } from "../src/index";

describe("greet", () => {
  it("greets by name", () => {
    expect(greet("world")).toBe("hello, world");
  });
});
