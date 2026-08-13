import { existsSync } from "node:fs";
import { resolve, dirname, basename, isAbsolute, relative } from "node:path";
import { pathToFileURL } from "node:url";
import type { WorkflowDefinition } from "./types.js";
import { SdkError } from "../errors.js";

const CONFIG_NAMES = ["sverka.config.ts", "sverka.config.js"];
const MAX_PARENTS = 5;

/**
 * Search upward from `root` for sverka.config.ts (then .js). Returns the
 * path or null. Searches up to 5 parent directories.
 */
export async function findConfig(root: string): Promise<string | null> {
  let dir = resolve(root);
  for (let i = 0; i <= MAX_PARENTS; i++) {
    for (const name of CONFIG_NAMES) {
      const candidate = resolve(dir, name);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return null;
}

/**
 * Dynamically import a sverka.config.ts file and return its default
 * export as a WorkflowDefinition. Validates the shape.
 *
 * Under Bun, .ts files import natively. Under Node, use the .js fallback
 * (findConfig searches .ts first, then .js).
 */
export async function loadWorkflow(
  configPath: string,
  root?: string,
): Promise<WorkflowDefinition> {
  const resolved = isAbsolute(configPath)
    ? resolve(configPath)
    : resolve(root ?? process.cwd(), configPath);

  if (!existsSync(resolved)) {
    throw new SdkError(
      `config file not found: ${configPath}`,
      "CONFIG_NOT_FOUND",
    );
  }

  if (root !== undefined) {
    const rel = relative(resolve(root), resolved);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
      throw new SdkError(
        `config path escapes root: ${configPath}`,
        "CONFIG_PATH_ESCAPE",
      );
    }
  }

  let mod: unknown;
  try {
    const url = pathToFileURL(resolved).href;
    mod = await import(url);
  } catch (e) {
    throw new SdkError(
      `failed to load config: ${basename(configPath)}`,
      "CONFIG_LOAD_FAILED",
      e,
    );
  }

  const def = (mod as { default?: unknown }).default;
  validateDefaultExport(def);
  validateWorkflowShape(def.workflow as Record<string, unknown>);

  return def as unknown as WorkflowDefinition;
}

function validateDefaultExport(
  def: unknown,
): asserts def is Record<string, unknown> {
  if (!isPlainObject(def)) {
    throw new SdkError(
      "config default export must be an object",
      "CONFIG_INVALID",
    );
  }

  if (typeof def.name !== "string" || def.name.length === 0) {
    throw new SdkError(
      "config default export must have a non-empty 'name' string",
      "CONFIG_INVALID",
    );
  }

  if (!isPlainObject(def.workflow)) {
    throw new SdkError(
      "config default export must have a 'workflow' object",
      "CONFIG_INVALID",
    );
  }
}

// Accept either a Workflow (has 'roots' array and 'plan' function) or
// a bare Operation (has 'kind' and 'spec'). The SDK normalizes Operations
// to Workflows at runtime.
function validateWorkflowShape(wf: Record<string, unknown>): void {
  const isWorkflow = Array.isArray(wf.roots) && typeof wf.plan === "function";
  const isOperation = typeof wf.kind === "string" && isPlainObject(wf.spec);
  if (!isWorkflow && !isOperation) {
    throw new SdkError(
      "config 'workflow' must be a Workflow (with 'roots' and 'plan') or an Operation (with 'kind' and 'spec')",
      "CONFIG_INVALID",
    );
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
