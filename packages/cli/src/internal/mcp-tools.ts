// MCP tool definitions — 5 Sverka operations exposed as MCP tools.
// Spec 28 — sverka mcp-server.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GlobalFlags, OutputWriter } from "../types.js";
import { ExitCode } from "../types.js";
import { validateCommand } from "../commands/validate.js";
import { planCommand } from "../commands/plan.js";
import { graphCommand } from "../commands/graph.js";
import { runCommand } from "../commands/run.js";
import { compileGithub, compileGitlab } from "@sverka/compiler";
import type { CompilationResult } from "@sverka/compiler";
import { loadProjectGraph } from "./config.js";
import { BufferingOutputWriter } from "./buffering-writer.js";

/** MCP CallToolResult shape (kept loose to avoid deep SDK type coupling). */
interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

/** Build GlobalFlags for JSON-format command execution. */
function jsonFlags(root: string): GlobalFlags {
  return { format: "json", config: null, root, quiet: false, verbose: false };
}

/** Safely parse JSON, returning null on failure. */
function safeJsonParse(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Run a CLI command handler with a buffering writer and return an MCP
 * CallToolResult. On success (exit 0), the captured JSON `data` field is
 * returned as text content. On failure, isError is set with the error message.
 */
export async function runCommandAsTool(
  fn: (writer: OutputWriter, global: GlobalFlags, start: number) => Promise<number>,
  root: string,
): Promise<ToolResult> {
  const writer = new BufferingOutputWriter();
  const global = jsonFlags(root);
  const start = Date.now();
  try {
    const exitCode = await fn(writer, global, start);
    const text = writer.captured.trim();
    if (exitCode === ExitCode.Success) {
      const parsed = text ? safeJsonParse(text) : null;
      const data = parsed && typeof parsed === "object" && "data" in parsed
        ? (parsed as { data: unknown }).data
        : parsed ?? {};
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
    const parsed = text ? safeJsonParse(text) : null;
    const msg = parsed ? JSON.stringify(parsed) : text || `exit code ${exitCode}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}

/** Tool metadata for testing and introspection. */
export interface SverkaToolDef {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

/** The 5 Sverka MCP tool definitions (name, description, zod schema shape). */
export const SVERKA_TOOLS: readonly SverkaToolDef[] = [
  {
    name: "sverka.validate",
    description: "Validate a sverka config: synthesize the Definition Graph and run validators.",
    inputSchema: { root: z.string().optional() },
  },
  {
    name: "sverka.plan",
    description: "Bind an Entry and inputs into a Run Plan and return the step list.",
    inputSchema: { root: z.string().optional(), entryId: z.string().optional() },
  },
  {
    name: "sverka.graph",
    description: "Display the Definition Graph: pipelines, entries, steps, and dependencies.",
    inputSchema: { root: z.string().optional() },
  },
  {
    name: "sverka.run",
    description: "Execute the workflow locally through the native engine and return the run status.",
    inputSchema: {
      root: z.string().optional(),
      entryId: z.string().optional(),
      executor: z.enum(["host", "docker"]).optional(),
    },
  },
  {
    name: "sverka.synth",
    description: "Compile the workflow to a target CI YAML (github or gitlab).",
    inputSchema: {
      root: z.string().optional(),
      target: z.enum(["github", "gitlab"]),
    },
  },
] as const;

/**
 * Register all 5 Sverka MCP tools on the given McpServer.
 * Each tool maps to the corresponding CLI command handler.
 */
export function registerSverkaTools(server: McpServer, defaultRoot: string): void {
  server.tool(
    "sverka.validate",
    "Validate a sverka config: synthesize the Definition Graph and run validators.",
    { root: z.string().optional() },
    async (args: { root?: string }) => {
      return runCommandAsTool(
        (w, g, s) => validateCommand(g, w, s),
        args.root ?? defaultRoot,
      );
    },
  );

  server.tool(
    "sverka.plan",
    "Bind an Entry and inputs into a Run Plan and return the step list.",
    { root: z.string().optional(), entryId: z.string().optional() },
    async (args: { root?: string; entryId?: string }) => {
      return runCommandAsTool(
        (w, g, s) => planCommand({ entryId: args.entryId }, g, w, s),
        args.root ?? defaultRoot,
      );
    },
  );

  server.tool(
    "sverka.graph",
    "Display the Definition Graph: pipelines, entries, steps, and dependencies.",
    { root: z.string().optional() },
    async (args: { root?: string }) => {
      return runCommandAsTool(
        (w, g, s) => graphCommand(g, w, s),
        args.root ?? defaultRoot,
      );
    },
  );

  server.tool(
    "sverka.run",
    "Execute the workflow locally through the native engine and return the run status.",
    { root: z.string().optional(), entryId: z.string().optional(), executor: z.enum(["host", "docker"]).optional() },
    async (args: { root?: string; entryId?: string; executor?: "host" | "docker" }) => {
      return runCommandAsTool(
        (w, g, s) => runCommand({ entryId: args.entryId, executor: args.executor }, g, w, s),
        args.root ?? defaultRoot,
      );
    },
  );

  server.tool(
    "sverka.synth",
    "Compile the workflow to a target CI YAML (github or gitlab).",
    { root: z.string().optional(), target: z.enum(["github", "gitlab"]) },
    async (args: { root?: string; target: "github" | "gitlab" }) => {
      return synthTool(args.root ?? defaultRoot, args.target);
    },
  );
}

/** Run the synth tool: load graph, compile to target, return artifacts. */
async function synthTool(root: string, target: "github" | "gitlab"): Promise<ToolResult> {
  try {
    const { graph } = await loadProjectGraph({ root, config: null });
    const result: CompilationResult =
      target === "github" ? compileGithub(graph) : compileGitlab(graph);
    const data = {
      target,
      artifacts: result.artifacts.map((a) => ({ path: a.path, content: a.content })),
      diagnostics: result.diagnostics,
    };
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}
