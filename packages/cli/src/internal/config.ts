// Config loading — loads a sverka.config.ts file and returns the Project.
// Spec 17 — §30.

import { readFile, writeFile } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { join, resolve, isAbsolute, dirname } from "node:path";
import type { Project } from "@sverka/workflow";
import { synthesize } from "@sverka/workflow";
import type { DefinitionGraph } from "@sverka/workflow";
import { resolveUnderRoot } from "./paths.js";
import { CliError, ExitCode } from "../types.js";

const require = createRequire(import.meta.url);

/** Package-manager names supported by `init` templates. */
export type PmName = "npm" | "pnpm" | "yarn" | "bun";

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
 * Resolve the effective config path from global flags.
 * Throws a usage error when no config can be found.
 */
export async function resolveConfigPath(global: {
  root: string;
  config: string | null;
}): Promise<string> {
  let configPath: string | null = global.config
    ? resolveUnderRoot(global.root, global.config)
    : null;
  if (!configPath) {
    configPath = await findConfig(global.root);
  }
  if (!configPath) {
    throw new CliError(
      "no config found (use --config to specify a path)",
      "MISSING_ARG",
      ExitCode.UsageError,
    );
  }
  return configPath;
}

/**
 * Structural check that avoids `instanceof` across package boundaries.
 * A Project-like object has a `node` with an `id` string and `children` array.
 */
function assertProjectLike(value: unknown): asserts value is Project {
  if (value === null || typeof value !== "object") {
    throw new CliError(
      "config must export a Project instance (default or named 'project')",
      "SDK_ERROR",
      ExitCode.RuntimeError,
    );
  }
  const node = (value as { node?: unknown }).node;
  if (
    typeof node !== "object" ||
    node === null ||
    typeof (node as { id?: unknown }).id !== "string" ||
    !Array.isArray((node as { children?: unknown }).children)
  ) {
    throw new CliError(
      "config must export a Project instance (default or named 'project')",
      "SDK_ERROR",
      ExitCode.RuntimeError,
    );
  }
}

/**
 * Load a sverka config file and return the Project construct.
 * The config file must export a `default` Project-like instance or a named
 * `project` Project-like instance.
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

  // Prefer the named `project` export, then fall back to `default`.
  // This avoids selecting an unrelated default export when a valid
  // named `project` export exists.
  const project = mod.project ?? mod.default;
  assertProjectLike(project);

  return project;
}

/**
 * Resolve, load, and synthesize the config for commands that need a graph.
 */
export async function loadProjectGraph(global: {
  root: string;
  config: string | null;
}): Promise<{ configPath: string; project: Project; graph: DefinitionGraph }> {
  const configPath = await resolveConfigPath(global);
  const project = await loadConfig(configPath);
  const graph = synthesize(project);
  return { configPath, project, graph };
}

/**
 * Detect the package manager used by the project at `root`.
 * Falls back to `npm` when no lockfile or packageManager field is found.
 */
export function detectPackageManager(root: string): PmName {
  const fromLockfile = detectFromLockfile(root);
  if (fromLockfile) return fromLockfile;

  const fromPkg = detectFromPackageJson(root);
  if (fromPkg) return fromPkg;

  return "npm";
}

function detectFromLockfile(root: string): PmName | undefined {
  if (existsSync(join(root, "bun.lockb")) || existsSync(join(root, "bun.lock"))) {
    return "bun";
  }
  if (existsSync(join(root, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (existsSync(join(root, "yarn.lock"))) {
    return "yarn";
  }
  if (existsSync(join(root, "package-lock.json"))) {
    return "npm";
  }
  return undefined;
}

function detectFromPackageJson(root: string): PmName | undefined {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return undefined;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      packageManager?: string;
    };
    if (typeof pkg.packageManager === "string") {
      return pmFromPackageManagerField(pkg.packageManager);
    }
  } catch {
    // ignore malformed package.json
  }
  return undefined;
}

function pmFromPackageManagerField(packageManager: string): PmName | undefined {
  if (packageManager.startsWith("npm")) return "npm";
  if (packageManager.startsWith("pnpm")) return "pnpm";
  if (packageManager.startsWith("yarn")) return "yarn";
  if (packageManager.startsWith("bun")) return "bun";
  return undefined;
}

/**
 * Ensure `@sverka/cdk` is declared as a devDependency of the target
 * project. Creates a minimal package.json when one does not exist.
 */
export async function ensureConstructsDependency(root: string): Promise<void> {
  const pkgPath = join(root, "package.json");
  const base = await loadPackageBase(pkgPath);

  const pkg: Record<string, unknown> = {
    name: base.name ?? "sverka-project",
    version: base.version ?? "0.0.0",
    ...base,
  };

  ensureConstructsDeclared(pkg, root);

  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
}

async function loadPackageBase(pkgPath: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(pkgPath, "utf8")) as Record<string, unknown>;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { name: "sverka-project", version: "0.0.0" };
    }
    const reason = e instanceof Error ? e.message : String(e);
    throw new CliError(
      `failed to read package.json: ${reason}`,
      "PACKAGE_ERROR",
      ExitCode.RuntimeError,
      e,
    );
  }
}

function ensureConstructsDeclared(pkg: Record<string, unknown>, root: string): void {
  const deps = (pkg.dependencies as Record<string, unknown> | undefined) ?? {};
  const devDeps =
    (pkg.devDependencies as Record<string, unknown> | undefined) ?? {};

  // Migration: remove the old @sverka/constructs package if present.
  if ("@sverka/constructs" in deps) {
    delete (deps as Record<string, unknown>)["@sverka/constructs"];
    pkg.dependencies = deps;
  }
  if ("@sverka/constructs" in devDeps) {
    delete (devDeps as Record<string, unknown>)["@sverka/constructs"];
    pkg.devDependencies = devDeps;
  }

  if (!("@sverka/cdk" in deps) && !("@sverka/cdk" in devDeps)) {
    const version = isLocalWorkspace(root) ? "workspace:*" : getDefaultConstructsVersion();
    pkg.devDependencies = { ...devDeps, "@sverka/cdk": version };
  }
}

function isLocalWorkspace(root: string): boolean {
  const rootPkg = join(root, "package.json");
  const constructsPkg = join(root, "packages", "cdk", "package.json");

  try {
    const rootData = JSON.parse(readFileSync(rootPkg, "utf8")) as {
      workspaces?: string[] | { packages?: string[] };
    };
    const constructs = JSON.parse(readFileSync(constructsPkg, "utf8")) as {
      name?: string;
    };
    if (constructs.name !== "@sverka/cdk") return false;
    const patterns = Array.isArray(rootData.workspaces)
      ? rootData.workspaces
      : rootData.workspaces?.packages ?? [];
    return patterns.some((pattern) => pattern.startsWith("packages"));
  } catch {
    return false;
  }
}

function getDefaultConstructsVersion(): string {
  try {
    // @sverka/cdk only exports "." in its exports map, so resolve the
    // package entry point and read the sibling package.json.
    const entryPath = require.resolve("@sverka/cdk");
    const pkgPath = join(dirname(entryPath), "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return pkg.version ? `^${pkg.version}` : "*";
  } catch {
    return "*";
  }
}
