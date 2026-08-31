// Spec 28 — sverka mcp-server (test plan items 1–11).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import process from "node:process";

// ---------------------------------------------------------------------------
// Mock the MCP SDK server-side. McpServer captures tool registrations so
// tests can invoke tool callbacks directly without spawning a subprocess.
// ---------------------------------------------------------------------------

interface CapturedTool {
  name: string;
  description: string;
  paramsSchema: Record<string, unknown>;
  callback: (args: Record<string, unknown>) => Promise<unknown>;
}

class MockMcpServer {
  tools = new Map<string, CapturedTool>();
  connected = false;
  closed = false;

  tool(
    name: string,
    description: string,
    paramsSchema: Record<string, unknown>,
    callback: (args: Record<string, unknown>) => Promise<unknown>,
  ): void {
    this.tools.set(name, { name, description, paramsSchema, callback });
  }

  connect = vi.fn(async () => {
    this.connected = true;
  });

  close = vi.fn(async () => {
    this.closed = true;
  });
}

const mockServerInstances: MockMcpServer[] = [];

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: vi.fn(function () {
    const inst = new MockMcpServer();
    mockServerInstances.push(inst);
    return inst;
  }),
}));

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: vi.fn(function () {
    return { start: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  }),
}));

// Imported AFTER vi.mock so mocks apply.
import { mcpServerCommand } from "../commands/mcp-server.js";
import { runCommandAsTool, registerSverkaTools, SVERKA_TOOLS } from "../internal/mcp-tools.js";
import { BufferingOutputWriter } from "../internal/buffering-writer.js";
import { validateCommand } from "../commands/validate.js";
import { main } from "../index.js";
import {
  makeTempDir,
  cleanupTempDir,
  CaptureWriter,
  writefile,
} from "./helpers/fixtures.js";

const VALID_CONFIG = `import { Project, Pipeline, ShellStep, Entry } from "@sverka/workflow";
const proj = new Project("myproj");
const pipeline = new Pipeline(proj, "ci");
new ShellStep(pipeline, "build", { command: "echo build" });
new Entry(pipeline, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
export default proj;
`;

/** A shutdown signal that resolves immediately (for tests). */
function immediateShutdown(): Promise<void> {
  return Promise.resolve();
}

function lastServer(): MockMcpServer {
  const s = mockServerInstances.at(-1);
  if (!s) throw new Error("no MockMcpServer instance");
  return s;
}

function makeGlobal(root: string) {
  return { format: "human" as const, config: null, root, quiet: false, verbose: false };
}

describe("sverka mcp-server", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
    mockServerInstances.length = 0;
  });

  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  // Item 10 + 1: mcp-server command is registered in main dispatch + --help
  it("mcp-server command is registered in main dispatch (--help shows it)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const out = new CaptureWriter();
    await main(["mcp-server", "--help"], { output: out });
    const helpText = logSpy.mock.calls.map((c) => String(c[0])).join("");
    logSpy.mockRestore();
    expect(helpText).toContain("mcp-server");
    expect(helpText.toLowerCase()).toContain("mcp");
  });

  // Item 3: tools/list returns 5 tools with correct names + schemas
  it("registers exactly 5 tools with correct names", async () => {
    await mcpServerCommand({}, makeGlobal(dir), new CaptureWriter(), Date.now(), immediateShutdown());
    const server = lastServer();
    expect(server.tools.size).toBe(5);
    expect(server.tools.has("sverka.validate")).toBe(true);
    expect(server.tools.has("sverka.plan")).toBe(true);
    expect(server.tools.has("sverka.graph")).toBe(true);
    expect(server.tools.has("sverka.run")).toBe(true);
    expect(server.tools.has("sverka.synth")).toBe(true);
  });

  it("tool definitions have descriptions and schemas", () => {
    expect(SVERKA_TOOLS.length).toBe(5);
    for (const tool of SVERKA_TOOLS) {
      expect(tool.name).toMatch(/^sverka\./);
      expect(tool.description.length).toBeGreaterThan(10);
      expect(typeof tool.inputSchema).toBe("object");
    }
  });

  it("sverka.synth tool schema requires target", () => {
    const synth = SVERKA_TOOLS.find((t) => t.name === "sverka.synth");
    expect(synth).toBeDefined();
    expect(synth!.inputSchema).toHaveProperty("target");
  });

  it("sverka.run tool schema has executor enum", () => {
    const run = SVERKA_TOOLS.find((t) => t.name === "sverka.run");
    expect(run).toBeDefined();
    expect(run!.inputSchema).toHaveProperty("executor");
  });

  // Item 4: tools/call sverka.validate returns structured result
  it("sverka.validate tool returns { valid: true } for valid config", async () => {
    await writefile(dir, "sverka.config.ts", VALID_CONFIG);
    await mcpServerCommand({}, makeGlobal(dir), new CaptureWriter(), Date.now(), immediateShutdown());
    const server = lastServer();
    const tool = server.tools.get("sverka.validate")!;
    const result = await tool.callback({}) as { content: { text: string }[]; isError?: boolean };
    expect(result.isError).not.toBe(true);
    const data = JSON.parse(result.content[0]!.text);
    expect(data.valid).toBe(true);
  });

  // Item 7: command handler failure → isError: true
  it("sverka.validate tool returns isError for missing config", async () => {
    await mcpServerCommand({}, makeGlobal(dir), new CaptureWriter(), Date.now(), immediateShutdown());
    const server = lastServer();
    const tool = server.tools.get("sverka.validate")!;
    const result = await tool.callback({}) as { content: { text: string }[]; isError?: boolean };
    expect(result.isError).toBe(true);
  });

  // Item 5: tools/call sverka.run returns status
  it("sverka.run tool returns { status } for valid config", async () => {
    await writefile(dir, "sverka.config.ts", VALID_CONFIG);
    await mcpServerCommand({}, makeGlobal(dir), new CaptureWriter(), Date.now(), immediateShutdown());
    const server = lastServer();
    const tool = server.tools.get("sverka.run")!;
    const result = await tool.callback({}) as { content: { text: string }[]; isError?: boolean };
    const data = JSON.parse(result.content[0]!.text);
    expect(data).toHaveProperty("status");
  });

  // sverka.plan tool returns plan data
  it("sverka.plan tool returns step list", async () => {
    await writefile(dir, "sverka.config.ts", VALID_CONFIG);
    await mcpServerCommand({}, makeGlobal(dir), new CaptureWriter(), Date.now(), immediateShutdown());
    const server = lastServer();
    const tool = server.tools.get("sverka.plan")!;
    const result = await tool.callback({}) as { content: { text: string }[]; isError?: boolean };
    expect(result.isError).not.toBe(true);
    const data = JSON.parse(result.content[0]!.text);
    expect(data).toHaveProperty("steps");
  });

  // sverka.graph tool returns graph data
  it("sverka.graph tool returns pipeline info", async () => {
    await writefile(dir, "sverka.config.ts", VALID_CONFIG);
    await mcpServerCommand({}, makeGlobal(dir), new CaptureWriter(), Date.now(), immediateShutdown());
    const server = lastServer();
    const tool = server.tools.get("sverka.graph")!;
    const result = await tool.callback({}) as { content: { text: string }[]; isError?: boolean };
    expect(result.isError).not.toBe(true);
    const data = JSON.parse(result.content[0]!.text);
    expect(data).toHaveProperty("project");
  });

  // sverka.synth tool returns compiled yaml
  it("sverka.synth tool returns artifacts for github target", async () => {
    await writefile(dir, "sverka.config.ts", VALID_CONFIG);
    await mcpServerCommand({}, makeGlobal(dir), new CaptureWriter(), Date.now(), immediateShutdown());
    const server = lastServer();
    const tool = server.tools.get("sverka.synth")!;
    const result = await tool.callback({ target: "github" }) as { content: { text: string }[]; isError?: boolean };
    expect(result.isError).not.toBe(true);
    const data = JSON.parse(result.content[0]!.text);
    expect(data).toHaveProperty("target", "github");
    expect(data).toHaveProperty("artifacts");
    expect(Array.isArray(data.artifacts)).toBe(true);
  });

  // Item 2: server connects to transport (handshake)
  it("server connects to transport on startup", async () => {
    await mcpServerCommand({}, makeGlobal(dir), new CaptureWriter(), Date.now(), immediateShutdown());
    const server = lastServer();
    expect(server.connect).toHaveBeenCalledTimes(1);
  });

  // Item 8: shutdown signal → clean shutdown (server.close called)
  it("server closes on shutdown signal", async () => {
    await mcpServerCommand({}, makeGlobal(dir), new CaptureWriter(), Date.now(), immediateShutdown());
    const server = lastServer();
    expect(server.close).toHaveBeenCalledTimes(1);
  });

  // Item 9: no stdout pollution — BufferingOutputWriter routes errors to stderr
  it("BufferingOutputWriter captures stdout, routes errors to stderr", () => {
    const writer = new BufferingOutputWriter();
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    writer.writeLine("stdout content");
    writer.errorLine("stderr content");
    writer.debug("debug content");

    expect(writer.captured).toContain("stdout content");
    expect(stderrSpy).toHaveBeenCalled();
    expect(stderrSpy.mock.calls.some((c) => String(c[0]).includes("stderr content"))).toBe(true);

    stderrSpy.mockRestore();
  });

  // runCommandAsTool direct tests
  describe("runCommandAsTool", () => {
    it("returns success result for valid config", async () => {
      await writefile(dir, "sverka.config.ts", VALID_CONFIG);
      const result = await runCommandAsTool(
        (w, g, s) => validateCommand(g, w, s),
        dir,
      );
      expect(result.isError).not.toBe(true);
      const data = JSON.parse(result.content[0]!.text);
      expect(data.valid).toBe(true);
    });

    it("returns isError for missing config", async () => {
      const result = await runCommandAsTool(
        (w, g, s) => validateCommand(g, w, s),
        dir,
      );
      expect(result.isError).toBe(true);
    });

    it("returns isError on thrown exception", async () => {
      const result = await runCommandAsTool(
        async () => {
          throw new Error("boom");
        },
        dir,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toBe("boom");
    });
  });

  // registerSverkaTools direct test
  it("registerSverkaTools registers 5 tools on a server-like object", () => {
    const fakeServer = {
      tool: vi.fn(),
    };
    registerSverkaTools(fakeServer as unknown as never, dir);
    expect(fakeServer.tool).toHaveBeenCalledTimes(5);
  });
});
