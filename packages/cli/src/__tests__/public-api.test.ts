import { describe, it, expect } from "vitest";
import { CliError } from "../index.js";

describe("CliError", () => {
  it("sets message, code, and context", () => {
    const err = new CliError("command not found", "NOT_FOUND", { command: "sverka" });
    expect(err.message).toBe("command not found");
    expect(err.code).toBe("NOT_FOUND");
    expect(err.context).toEqual({ command: "sverka" });
  });

  it("sets name to CliError", () => {
    const err = new CliError("fail", "FAIL");
    expect(err.name).toBe("CliError");
  });

  it("is an instance of Error", () => {
    const err = new CliError("fail", "FAIL");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CliError);
  });

  it("context is optional", () => {
    const err = new CliError("fail", "FAIL");
    expect(err.context).toBeUndefined();
  });
});
