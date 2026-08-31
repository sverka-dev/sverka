// Spec 23 — MCPClientPool behavior (test plan items 1–9).
import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock the MCP SDK. Each Client instance is a controllable mock so tests can
// drive connect/listTools/callTool/close without spawning processes or HTTP.
// ---------------------------------------------------------------------------

const clientInstances: MockClient[] = [];

class MockClient {
  connect = vi.fn(async () => {
    if (this.connectShouldThrow) {
      throw new Error(this.connectErrorMessage ?? "connect failed");
    }
  });
  listTools = vi.fn(async () => ({ tools: this.tools }));
  callTool = vi.fn(async () => this.callToolResponse);
  close = vi.fn(async () => {
    if (this.closeShouldThrow) throw new Error("close failed");
  });

  tools: { name: string; description?: string; inputSchema?: Record<string, unknown> }[] = [];
  callToolResponse: { content: unknown[]; isError?: boolean } = { content: [] };
  connectShouldThrow = false;
  connectErrorMessage?: string;
  closeShouldThrow = false;
}

const transportInstances: Record<string, unknown[]> = {
  stdio: [],
  streamableHttp: [],
  sse: [],
};

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn(function () {
    const inst = new MockClient();
    clientInstances.push(inst);
    return inst;
  }),
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: vi.fn(function (opts: unknown) {
    const t = { kind: "stdio", opts };
    transportInstances.stdio.push(t);
    return t;
  }),
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: vi.fn(function (url: unknown) {
    const t = { kind: "streamableHttp", url, shouldFailConnect: false };
    transportInstances.streamableHttp.push(t);
    return t;
  }),
}));

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: vi.fn(function (url: unknown) {
    const t = { kind: "sse", url };
    transportInstances.sse.push(t);
    return t;
  }),
}));

// Imported AFTER vi.mock so the mocks apply.
import { createMCPPlugin } from "../index.js";
import { MCPClientPool } from "../client.js";
import { MCPPluginError } from "../errors.js";
import type { MCPServerConfig } from "../index.js";

function stdioServer(name: string, command = "echo"): MCPServerConfig {
  return { name, transport: "stdio", command };
}

function httpServer(name: string, url = "http://localhost:9000"): MCPServerConfig {
  return { name, transport: "http", url };
}

beforeEach(() => {
  clientInstances.length = 0;
  transportInstances.stdio.length = 0;
  transportInstances.streamableHttp.length = 0;
  transportInstances.sse.length = 0;
});

describe("MCPClientPool — Spec 23", () => {
  it("item 1: empty servers → empty listTools, no connections opened", async () => {
    const pool = new MCPClientPool([]);
    const tools = await pool.listTools();
    expect(tools).toEqual([]);
    expect(clientInstances).toHaveLength(0);
  });

  it("item 2: single stdio server — listTools prefixes names, callTool proxies", async () => {
    const pool = new MCPClientPool([stdioServer("srv")]);
    // listTools triggers lazy connect
    const tools = await pool.listTools();
    expect(clientInstances).toHaveLength(1);
    const client = clientInstances[0]!;
    client.tools = [{ name: "echo", description: "echoes back" }];
    const tools2 = await pool.listTools();
    expect(tools2).toHaveLength(1);
    expect(tools2[0]?.name).toBe("srv.echo");
    expect(tools2[0]?.description).toBe("echoes back");
    // callTool proxies to the server with the unprefixed tool name
    client.callToolResponse = { content: [{ type: "text", text: "hi" }] };
    const result = await pool.callTool("srv.echo", { x: 1 });
    expect(client.callTool).toHaveBeenCalledWith({ name: "echo", arguments: { x: 1 } });
    expect(result.content[0]).toEqual({ type: "text", text: "hi" });
  });

  it("item 3: lazy connect — createMCPPlugin does NOT spawn a process", () => {
    createMCPPlugin({ servers: [stdioServer("srv")] });
    expect(clientInstances).toHaveLength(0);
    expect(transportInstances.stdio).toHaveLength(0);
  });

  it("item 4: multi-server namespacing — s1.foo and s2.foo don't collide", async () => {
    const pool = new MCPClientPool([stdioServer("s1"), stdioServer("s2")]);
    clientInstances.length = 0; // reset so we can map after connect
    // Pre-seed tools by connecting each server via listTools, then configure.
    const tools = await pool.listTools();
    expect(tools).toEqual([]);
    expect(clientInstances).toHaveLength(2);
    clientInstances[0]!.tools = [{ name: "foo" }];
    clientInstances[1]!.tools = [{ name: "foo" }];
    const tools2 = await pool.listTools();
    const names = tools2.map((t) => t.name);
    expect(names).toContain("s1.foo");
    expect(names).toContain("s2.foo");
  });

  it("item 5: callTool with unknown server prefix → TOOL_NOT_FOUND", async () => {
    const pool = new MCPClientPool([stdioServer("srv")]);
    await expect(pool.callTool("other.tool")).rejects.toMatchObject({
      code: "TOOL_NOT_FOUND",
    });
    expect(clientInstances).toHaveLength(0); // never connected (lookup fails first)
  });

  it("item 5b: callTool with un-namespaced name → TOOL_NOT_FOUND", async () => {
    const pool = new MCPClientPool([stdioServer("srv")]);
    await expect(pool.callTool("nope")).rejects.toMatchObject({
      code: "TOOL_NOT_FOUND",
    });
  });

  it("item 6: server returns isError: true → TOOL_CALL_FAILED", async () => {
    const pool = new MCPClientPool([stdioServer("srv")]);
    await pool.listTools();
    const client = clientInstances[0]!;
    client.callToolResponse = { content: [], isError: true };
    await expect(pool.callTool("srv.echo")).rejects.toMatchObject({
      code: "TOOL_CALL_FAILED",
    });
  });

  it("item 6b: server callTool throws → TOOL_CALL_FAILED", async () => {
    const pool = new MCPClientPool([stdioServer("srv")]);
    await pool.listTools();
    const client = clientInstances[0]!;
    client.callTool.mockRejectedValueOnce(new Error("boom"));
    await expect(pool.callTool("srv.echo")).rejects.toMatchObject({
      code: "TOOL_CALL_FAILED",
    });
  });

  it("item 7: connect failure (bad command) → CONNECT_FAILED", async () => {
    const pool = new MCPClientPool([stdioServer("srv")]);
    // Configure the next Client instance to fail connect.
    const originalPush = clientInstances.push.bind(clientInstances);
    clientInstances.push = ((inst: MockClient) => {
      inst.connectShouldThrow = true;
      return originalPush(inst);
    }) as typeof originalPush;
    await expect(pool.listTools()).rejects.toMatchObject({
      code: "CONNECT_FAILED",
    });
    clientInstances.push = originalPush;
  });

  it("item 8: dispose closes all clients; listTools after dispose re-connects", async () => {
    const pool = new MCPClientPool([stdioServer("s1"), stdioServer("s2")]);
    await pool.listTools();
    expect(clientInstances).toHaveLength(2);
    await pool.dispose();
    expect(clientInstances[0]!.close).toHaveBeenCalledTimes(1);
    expect(clientInstances[1]!.close).toHaveBeenCalledTimes(1);
    // After dispose, a new listTools re-connects (lazy) creating new clients.
    const countBefore = clientInstances.length;
    await pool.listTools();
    expect(clientInstances.length).toBe(countBefore + 2);
  });

  it("item 8b: dispose is safe to call when never connected", async () => {
    const pool = new MCPClientPool([stdioServer("srv")]);
    await expect(pool.dispose()).resolves.toBeUndefined();
    expect(clientInstances).toHaveLength(0);
  });

  it("item 8c: dispose is safe to call multiple times", async () => {
    const pool = new MCPClientPool([stdioServer("srv")]);
    await pool.listTools();
    await pool.dispose();
    await expect(pool.dispose()).resolves.toBeUndefined();
    expect(clientInstances[0]!.close).toHaveBeenCalledTimes(1);
  });

  it("item 8d: dispose ignores per-client close errors", async () => {
    const pool = new MCPClientPool([stdioServer("srv")]);
    await pool.listTools();
    clientInstances[0]!.closeShouldThrow = true;
    await expect(pool.dispose()).resolves.toBeUndefined();
  });

  it("item 9: HTTP — StreamableHTTP tried first, SSE fallback succeeds", async () => {
    const pool = new MCPClientPool([httpServer("srv")]);
    // Make the first Client (Streamable HTTP attempt) fail connect, so the
    // SSE fallback path is taken with a fresh client.
    let firstClient = true;
    const originalPush = clientInstances.push.bind(clientInstances);
    clientInstances.push = ((inst: MockClient) => {
      if (firstClient) {
        inst.connectShouldThrow = true;
        firstClient = false;
      }
      return originalPush(inst);
    }) as typeof originalPush;
    await pool.listTools();
    expect(transportInstances.streamableHttp).toHaveLength(1);
    expect(transportInstances.sse).toHaveLength(1);
    expect(clientInstances).toHaveLength(2); // first (failed) + second (SSE)
    clientInstances.push = originalPush;
  });

  it("createMCPPlugin returns a SverkaPlugin with tools + capabilities", async () => {
    const plugin = createMCPPlugin({ servers: [stdioServer("srv")] });
    expect(plugin.name).toBe("srv"); // single server → name derived
    expect(plugin.apiVersion).toBe("sverka.dev/v1");
    expect(plugin.capabilities).toEqual({
      "mcp.tools.list": "native",
      "mcp.tools.call": "native",
    });
    expect(plugin.tools).toBeDefined();
    const tools = await plugin.tools.listTools();
    expect(tools).toEqual([]);
  });

  it("createMCPPlugin with multiple servers → name is 'mcp'", () => {
    const plugin = createMCPPlugin({
      servers: [stdioServer("s1"), stdioServer("s2")],
    });
    expect(plugin.name).toBe("mcp");
  });

  it("createMCPPlugin with empty servers → name is 'mcp'", () => {
    const plugin = createMCPPlugin({ servers: [] });
    expect(plugin.name).toBe("mcp");
  });

  it("MCPPluginError is thrown (not a plain Error)", async () => {
    const pool = new MCPClientPool([stdioServer("other")]);
    try {
      await pool.callTool("missing.tool");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MCPPluginError);
    }
  });
});
