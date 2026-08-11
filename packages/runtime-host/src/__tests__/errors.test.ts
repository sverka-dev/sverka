import { describe, it, expect } from "vitest";
import {
  HostExecutorError,
  HostTimeoutError,
  CommandNotAllowedError,
} from "../errors.js";

describe("HostExecutorError", () => {
  it("sets name, code, and context", () => {
    const err = new HostExecutorError("boom", "BOOM", { key: "value" });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("HostExecutorError");
    expect(err.code).toBe("BOOM");
    expect(err.message).toBe("boom");
    expect(err.context).toEqual({ key: "value" });
  });

  it("context is optional", () => {
    const err = new HostExecutorError("boom", "BOOM");
    expect(err.context).toBeUndefined();
  });
});

describe("HostTimeoutError", () => {
  it("extends HostExecutorError with code HOST_TIMEOUT", () => {
    const err = new HostTimeoutError("timed out", { seconds: 30 });
    expect(err).toBeInstanceOf(HostExecutorError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("HostTimeoutError");
    expect(err.code).toBe("HOST_TIMEOUT");
    expect(err.context).toEqual({ seconds: 30 });
  });

  it("context is optional", () => {
    const err = new HostTimeoutError("timed out");
    expect(err.context).toBeUndefined();
  });
});

describe("CommandNotAllowedError", () => {
  it("extends HostExecutorError with code COMMAND_NOT_ALLOWED", () => {
    const err = new CommandNotAllowedError("not allowed", { command: "rm" });
    expect(err).toBeInstanceOf(HostExecutorError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CommandNotAllowedError");
    expect(err.code).toBe("COMMAND_NOT_ALLOWED");
    expect(err.context).toEqual({ command: "rm" });
  });

  it("context is optional", () => {
    const err = new CommandNotAllowedError("not allowed");
    expect(err.context).toBeUndefined();
  });
});
