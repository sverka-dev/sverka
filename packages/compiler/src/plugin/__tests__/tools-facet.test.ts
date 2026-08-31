// Spec 23 — tools facet on SverkaPlugin (items 10, 12).
import { describe, it, expect } from "vitest";
import {
  defineSverkaPlugin,
  createPluginRegistry,
  type SverkaPlugin,
  type ToolProvider,
  type ToolDefinition,
  type ToolResult,
  type ToolResultContent,
} from "../index.js";

function makeToolProvider(): ToolProvider {
  const tools: readonly ToolDefinition[] = [
    { name: "srv.echo", description: "echoes", inputSchema: { type: "object" } },
  ];
  return {
    async listTools() {
      return tools;
    },
    async callTool(name: string, args?: Readonly<Record<string, unknown>>) {
      void name;
      void args;
      const result: ToolResult = {
        content: [{ type: "text", text: "ok" }],
      };
      return result;
    },
  };
}

describe("tools facet — Spec 23", () => {
  it("SverkaPlugin accepts a `tools` ToolProvider (item 12)", () => {
    const plugin: SverkaPlugin = {
      name: "mcp",
      apiVersion: "sverka.dev/v1",
      tools: makeToolProvider(),
    };
    expect(plugin.tools).toBeDefined();
    expect(typeof plugin.tools?.listTools).toBe("function");
    expect(typeof plugin.tools?.callTool).toBe("function");
  });

  it("defineSverkaPlugin preserves the tools facet", async () => {
    const provider = makeToolProvider();
    const plugin = defineSverkaPlugin(() => ({
      name: "mcp",
      apiVersion: "sverka.dev/v1",
      capabilities: { "mcp.tools.list": "native", "mcp.tools.call": "native" },
      tools: provider,
    }));
    expect(plugin.tools).toBe(provider);
    const listed = await plugin.tools?.listTools();
    expect(listed).toHaveLength(1);
    expect(listed?.[0]?.name).toBe("srv.echo");
  });

  it("registry snapshot preserves the tools facet reference", async () => {
    const provider = makeToolProvider();
    const plugin = defineSverkaPlugin(() => ({
      name: "mcp",
      apiVersion: "sverka.dev/v1",
      tools: provider,
    }));
    const registry = createPluginRegistry();
    registry.register(plugin);
    const [registered] = registry.plugins;
    expect(registered.tools).toBe(provider);
    const result = await registered.tools?.callTool("srv.echo", { x: 1 });
    expect(result?.content[0]).toEqual({ type: "text", text: "ok" });
  });

  it("ToolResultContent variants are constructible (item 10 — types exported)", () => {
    const text: ToolResultContent = { type: "text", text: "hi" };
    const image: ToolResultContent = { type: "image", data: "b64", mimeType: "image/png" };
    const resource: ToolResultContent = {
      type: "resource",
      resource: { uri: "file:///x", mimeType: "text/plain" },
    };
    expect(text.type).toBe("text");
    expect(image.type).toBe("image");
    expect(resource.type).toBe("resource");
  });
});
