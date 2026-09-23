/**
 * Arena config file support — `arena.config.ts` exports declarative data;
 * the CLI resolves the agent adapter by name and validates the shape with
 * zod. See specs/49-arena-cli.
 */

import { z } from "zod";
import { pathToFileURL } from "node:url";
import { isAbsolute, resolve } from "node:path";

import type { AgentAdapter, ArenaConfig, ModelConfig } from "./types.js";
import { DevinAdapter } from "./adapters/devin.js";

export class ArenaError extends Error {
  constructor(
    message: string,
    readonly code: "CONFIG_INVALID" | "CONFIG_NOT_FOUND" | "UNKNOWN_AGENT",
  ) {
    super(message);
    this.name = "ArenaError";
  }
}

// ─── Adapter registry ────────────────────────────────────────────────

const ADAPTERS: Readonly<Record<string, () => AgentAdapter>> = {
  devin: () => new DevinAdapter(),
};

export function resolveAdapter(name: string): AgentAdapter {
  const factory = ADAPTERS[name];
  if (!factory) {
    throw new ArenaError(
      `unknown agent '${name}' — registered adapters: ${Object.keys(ADAPTERS).join(", ")}`,
      "UNKNOWN_AGENT",
    );
  }
  return factory();
}

// ─── Schema ──────────────────────────────────────────────────────────

const modelSchema = z.object({
  id: z.string(),
  name: z.string(),
  envVar: z.string().optional(),
});

const pluginSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  enabled: z.boolean().optional(),
  installPath: z.string().optional(),
});

const checkSchema = z.object({
  id: z.string(),
  command: z.string(),
  description: z.string(),
});

const taskSchema = z.object({
  id: z.string(),
  name: z.string(),
  prompt: z.string(),
  timeoutMs: z.number().optional(),
  successCriteria: z.string().optional(),
  expectedOutput: z.string().optional(),
  fixture: z.string().optional(),
  checks: z.array(checkSchema).optional(),
});

const configFileSchema = z.object({
  agent: z.string(),
  models: z.array(modelSchema).min(1),
  plugins: z.array(pluginSchema).optional(),
  tasks: z.array(taskSchema).min(1),
  workspace: z.string().optional(),
  repetitions: z.number().int().positive().optional(),
  outputDir: z.string(),
  judge: z
    .object({
      model: modelSchema,
      agent: z.string().optional(),
      repetitions: z.number().int().positive().optional(),
      revealPlugins: z.boolean().optional(),
      systemPrompt: z.string().optional(),
    })
    .optional(),
});

/** Declarative config shape authored in `arena.config.ts`. */
export type ArenaConfigFile = z.input<typeof configFileSchema>;

/** Type-only identity helper — gives configs full typechecking. */
export function defineConfig(config: ArenaConfigFile): ArenaConfigFile {
  return config;
}

// ─── Loader ──────────────────────────────────────────────────────────

/**
 * Load and validate an arena config file, resolving the named agent
 * (and judge agent, defaulting to the same adapter) to live adapters.
 */
export async function loadArenaConfig(
  configPath: string,
): Promise<ArenaConfig> {
  const absPath = isAbsolute(configPath)
    ? configPath
    : resolve(process.cwd(), configPath);

  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(absPath).href)) as Record<
      string,
      unknown
    >;
  } catch (err) {
    throw new ArenaError(
      `cannot load arena config '${absPath}': ${err instanceof Error ? err.message : String(err)}`,
      "CONFIG_NOT_FOUND",
    );
  }

  if (typeof mod.default !== "object" || mod.default === null) {
    throw new ArenaError(
      `arena config '${absPath}' must export a default config object`,
      "CONFIG_INVALID",
    );
  }

  const parsed = configFileSchema.safeParse(mod.default);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new ArenaError(
      `invalid arena config '${absPath}':\n${issues}`,
      "CONFIG_INVALID",
    );
  }

  const file = parsed.data;
  const agent = resolveAdapter(file.agent);
  return {
    agent,
    models: file.models as ModelConfig[],
    plugins: (file.plugins ?? []) as ArenaConfig["plugins"],
    tasks: file.tasks as ArenaConfig["tasks"],
    outputDir: file.outputDir,
    ...(file.workspace !== undefined ? { workspace: file.workspace } : {}),
    ...(file.repetitions !== undefined
      ? { repetitions: file.repetitions }
      : {}),
    ...(file.judge
      ? {
          judge: {
            model: file.judge.model as ModelConfig,
            agent: resolveAdapter(file.judge.agent ?? file.agent),
            ...(file.judge.repetitions !== undefined
              ? { repetitions: file.judge.repetitions }
              : {}),
            ...(file.judge.revealPlugins !== undefined
              ? { revealPlugins: file.judge.revealPlugins }
              : {}),
            ...(file.judge.systemPrompt !== undefined
              ? { systemPrompt: file.judge.systemPrompt }
              : {}),
          },
        }
      : {}),
  };
}
