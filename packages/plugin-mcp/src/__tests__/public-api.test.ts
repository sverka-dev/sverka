// Spec 23 — public API export assertions (item 11).
import { describe, it, expect } from "vitest";
import {
  createMCPPlugin,
  MCPPluginError,
  type MCPPluginConfig,
  type MCPServerConfig,
  type MCPPluginErrorCode,
  MCPClientPool,
} from "../index.js";

describe("public API — exports (item 11)", () => {
  it("exports createMCPPlugin function", () => {
    expect(typeof createMCPPlugin).toBe("function");
  });

  it("exports MCPPluginError class with override cause", () => {
    const cause = new Error("root");
    const err = new MCPPluginError("msg", "CONNECT_FAILED", cause);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(MCPPluginError);
    expect(err.name).toBe("MCPPluginError");
    expect(err.code).toBe("CONNECT_FAILED");
    expect(err.cause).toBe(cause);
  });

  it("exports MCPClientPool class", () => {
    expect(typeof MCPClientPool).toBe("function");
    const pool = new MCPClientPool([]);
    expect(typeof pool.listTools).toBe("function");
    expect(typeof pool.callTool).toBe("function");
    expect(typeof pool.dispose).toBe("function");
  });

  it("all types are importable (compile-time check)", () => {
    const _config: MCPPluginConfig = { servers: [] };
    const _server: MCPServerConfig = { name: "s", transport: "stdio", command: "x" };
    const _http: MCPServerConfig = { name: "s", transport: "http", url: "http://x" };
    const _code: MCPPluginErrorCode = "TOOL_NOT_FOUND";
    expect(_config.servers).toHaveLength(0);
    expect(_server.transport).toBe("stdio");
    expect(_http.transport).toBe("http");
    expect(_code).toBe("TOOL_NOT_FOUND");
  });
});
