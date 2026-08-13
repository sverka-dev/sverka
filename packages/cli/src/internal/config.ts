// Config loading — loads a sverka.config.ts file and returns the Project.
// Spec 17 — §30.

import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import { Project } from "@sverka/constructs";
import { CliError, ExitCode } from "../types.js";

/**
 * Find a sverka.config.ts or sverka.config.js file in the given root.
 * Returns the absolute path or null if not found.
 */
export async function findConfig(root: string): Promise<string | null> {
  const candidates = [
    "sverka.config.ts",
    "sverka.config.js",
    "sverka.config.mjs",
  ];
  for (const candidate of candidates) {
    const path = join(root, candidate);
    if (existsSync(path)) return path;
  }
  return null;
}

/**
 * Load a sverka config file and return the Project construct.
 * The config file must export a `default` Project instance or a named
 * `project` Project instance.
 *
 * @throws CliError if the config cannot be loaded or doesn't export a Project.
 */
export async function loadConfig(configPath: string): Promise<Project> {
  const absPath = isAbsolute(configPath)
    ? configPath
    : resolve(process.cwd(), configPath);

  if (!existsSync(absPath)) {
    throw new CliError(
      `config not found: ${absPath}`,
      "MISSING_ARG",
      ExitCode.UsageError,
    );
  }

  let mod: Record<string, unknown>;
  try {
    mod = await import(pathToFileURL(absPath).href);
  } catch (e) {
    throw new CliError(
      `failed to load config: ${e instanceof Error ? e.message : String(e)}`,
      "SDK_ERROR",
      ExitCode.RuntimeError,
      e,
    );
  }

  // Check for default export or named project export.
  const project = mod.default ?? mod.project;
  if (!(project instanceof Project)) {
    throw new CliError(
      "config must export a Project instance (default or named 'project')",
      "SDK_ERROR",
      ExitCode.RuntimeError,
    );
  }

  return project;
}
