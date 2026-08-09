import { describe, it, expect } from "vitest";
import {
  HostExecutor,
  createAllowlist,
  HostExecutorError,
  HostTimeoutError,
  CommandNotAllowedError,
} from "../index.js";
import type { HostExecutorConfig, CommandAllowlist } from "../index.js";

describe("public API", () => {
  it("exports HostExecutor class", () => {
    expect(typeof HostExecutor).toBe("function");
    const exec = new HostExecutor({
      enabled: true,
      allowlist: createAllowlist(["node"]),
      envAllowlist: ["PATH"],
    });
    expect(exec.name).toBe("host");
    expect(typeof exec.canExecute).toBe("function");
    expect(typeof exec.execute).toBe("function");
    expect(typeof exec.dispose).toBe("function");
  });

  it("exports createAllowlist function", () => {
    expect(typeof createAllowlist).toBe("function");
    const al = createAllowlist(["node"]);
    expect(al.isAllowed("node")).toBe(true);
  });

  it("exports error classes", () => {
    expect(new HostExecutorError("x", "X")).toBeInstanceOf(Error);
    expect(new HostTimeoutError("x")).toBeInstanceOf(HostExecutorError);
    expect(new CommandNotAllowedError("x")).toBeInstanceOf(HostExecutorError);
  });

  it("exports types (compile-time check)", () => {
    const config: HostExecutorConfig = {
      enabled: true,
      allowlist: createAllowlist(["node"]),
      envAllowlist: ["PATH"],
    };
    const al: CommandAllowlist = createAllowlist(["node"]);
    expect(config.enabled).toBe(true);
    expect(al.isAllowed("node")).toBe(true);
  });
});
