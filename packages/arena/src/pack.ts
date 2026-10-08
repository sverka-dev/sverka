/**
 * Task packs — shareable benchmark suites. A pack is a directory:
 *
 *   <pack>/
 *     pack.json        # { name, version, description, defaults }
 *     tasks/<id>.json  # { id, prompt, repo|fixture, checks, timeoutMs? }
 *
 * `sverka-arena run --pack <ref>` resolves a local dir, a git URL, or a
 * pack name inside a registry (`packs/<name>/`). Community contribution
 * is a git PR adding a pack — no registry write API needed.
 * Spec: specs/56-arena-eval-service.
 */
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";

import { ArenaError } from "./config.js";
import { git, gitOrThrow } from "./internal/git.js";
import { ensurePrivateDir } from "./internal/private-dir.js";
import { resolveRegistryDir } from "./registry.js";
import type { DeterministicCheck, Task } from "./types.js";

// ─── Schemas ─────────────────────────────────────────────────────────

const packCheckSchema = z.object({
  id: z.string().min(1),
  command: z.string().min(1),
  description: z.string().optional(),
});

const packTaskSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().optional(),
  prompt: z.string().min(1),
  timeoutMs: z.number().positive().optional(),
  /** Git URL cloned as the task's workspace seed. */
  repo: z.string().min(1).optional(),
  /** Directory inside the pack copied into the workspace. */
  fixture: z.string().min(1).optional(),
  setup: z.array(z.string()).optional(),
  checks: z.array(packCheckSchema).optional(),
  successCriteria: z.string().optional(),
  expectedOutput: z.string().optional(),
});

const packJsonSchema = z.object({
  name: z.string().min(1),
  version: z.string().optional(),
  description: z.string().optional(),
  defaults: z
    .object({
      timeoutMs: z.number().positive().optional(),
      repetitions: z.number().int().positive().optional(),
      outputDir: z.string().min(1).optional(),
    })
    .optional(),
});

export interface PackDefaults {
  readonly timeoutMs?: number;
  readonly repetitions?: number;
  readonly outputDir?: string;
}

export interface TaskPack {
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
  /** Local directory the pack was loaded from. */
  readonly dir: string;
  readonly tasks: readonly Task[];
  readonly defaults: PackDefaults;
}

export interface PackLint {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

// ─── Loading ─────────────────────────────────────────────────────────

interface LoadOptions {
  /** Where `repo:` fixtures are cloned (default: tmp cache). */
  cacheDir?: string;
}

type PackTask = z.infer<typeof packTaskSchema>;

/** Read + schema-validate one tasks/<id>.json file. */
async function parseTaskFile(file: string): Promise<PackTask> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    throw new ArenaError(
      `pack task '${file}' is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      "PACK_INVALID",
      err,
    );
  }
  const parsed = packTaskSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new ArenaError(
      `pack task '${file}' is invalid:\n${issues}`,
      "PACK_INVALID",
    );
  }
  return parsed.data;
}

/**
 * Resolve a task's fixture dir — a pack-relative directory (escape-safe)
 * or a cloned repo cache dir. Undefined when the task has neither.
 */
async function resolveTaskFixture(
  t: PackTask,
  id: string,
  dir: string,
  opts: LoadOptions,
): Promise<string | undefined> {
  if (t.fixture !== undefined && t.repo !== undefined) {
    throw new ArenaError(
      `pack task '${id}': cannot specify both 'fixture' and 'repo' — choose one`,
      "PACK_INVALID",
    );
  }
  if (t.repo !== undefined) {
    return cloneRepo(t.repo, opts);
  }
  if (t.fixture === undefined) return undefined;
  const fixture = resolve(dir, t.fixture);
  // Community packs arrive via git clone — a fixture must resolve
  // inside the pack dir (no ../ escapes) and be a directory.
  const rel = relative(dir, fixture);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new ArenaError(
      `pack task '${id}': fixture '${t.fixture}' escapes the pack dir`,
      "PACK_INVALID",
    );
  }
  if (!existsSync(fixture) || !statSync(fixture).isDirectory()) {
    throw new ArenaError(
      `pack task '${id}': fixture dir '${t.fixture}' does not exist in ${dir}`,
      "PACK_INVALID",
    );
  }
  return fixture;
}

async function taskFromFile(
  file: string,
  dir: string,
  defaults: PackDefaults,
  opts: LoadOptions,
): Promise<Task> {
  const t = await parseTaskFile(file);
  const id = t.id ?? basename(file, ".json");
  const fixture = await resolveTaskFixture(t, id, dir, opts);
  const checks: DeterministicCheck[] | undefined = t.checks?.map((c) => ({
    id: c.id,
    command: c.command,
    description: c.description ?? c.command,
  }));
  return {
    id,
    name: t.name ?? id,
    prompt: t.prompt,
    ...(t.timeoutMs !== undefined || defaults.timeoutMs !== undefined
      ? { timeoutMs: t.timeoutMs ?? defaults.timeoutMs! }
      : {}),
    ...(fixture !== undefined ? { fixture } : {}),
    ...(t.setup !== undefined ? { setup: t.setup } : {}),
    ...(checks !== undefined ? { checks } : {}),
    ...(t.successCriteria !== undefined
      ? { successCriteria: t.successCriteria }
      : {}),
    ...(t.expectedOutput !== undefined
      ? { expectedOutput: t.expectedOutput }
      : {}),
  };
}

type PackJson = z.infer<typeof packJsonSchema>;

/** Read + schema-validate pack.json. */
async function readPackJson(dir: string): Promise<PackJson> {
  const packJsonPath = join(dir, "pack.json");
  if (!existsSync(packJsonPath)) {
    throw new ArenaError(
      `no pack.json in '${dir}' — not a task pack`,
      "PACK_NOT_FOUND",
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(packJsonPath, "utf8"));
  } catch (err) {
    throw new ArenaError(
      `pack.json in '${dir}' is not valid JSON`,
      "PACK_INVALID",
      err,
    );
  }
  const parsed = packJsonSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new ArenaError(
      `pack.json in '${dir}' is invalid:\n${issues}`,
      "PACK_INVALID",
    );
  }
  return parsed.data;
}

/** exactOptionalPropertyTypes — drop keys whose value is undefined. */
function packDefaults(meta: PackJson): PackDefaults {
  return {
    ...(meta.defaults?.timeoutMs !== undefined
      ? { timeoutMs: meta.defaults.timeoutMs }
      : {}),
    ...(meta.defaults?.repetitions !== undefined
      ? { repetitions: meta.defaults.repetitions }
      : {}),
    ...(meta.defaults?.outputDir !== undefined
      ? { outputDir: meta.defaults.outputDir }
      : {}),
  };
}

/**
 * Load every tasks/*.json — fanned out (independent reads/clones), but
 * errors and duplicate-id checks stay deterministic in sorted-file order.
 */
async function loadTasks(
  dir: string,
  packName: string,
  defaults: PackDefaults,
  opts: LoadOptions,
): Promise<Task[]> {
  const tasksDir = join(dir, "tasks");
  const files = existsSync(tasksDir)
    ? (await readdir(tasksDir)).filter((f) => f.endsWith(".json")).sort()
    : [];
  const settled = await Promise.allSettled(
    files.map((f) => taskFromFile(join(tasksDir, f), dir, defaults, opts)),
  );
  const tasks: Task[] = [];
  const ids = new Set<string>();
  for (const s of settled) {
    if (s.status === "rejected") throw s.reason;
    if (ids.has(s.value.id)) {
      throw new ArenaError(
        `duplicate task id '${s.value.id}' in pack '${packName}'`,
        "PACK_INVALID",
      );
    }
    ids.add(s.value.id);
    tasks.push(s.value);
  }
  return tasks;
}

/** Load a pack directory into a {@link TaskPack}. */
export async function loadPack(
  dir: string,
  opts: LoadOptions = {},
): Promise<TaskPack> {
  const meta = await readPackJson(dir);
  const defaults = packDefaults(meta);
  const tasks = await loadTasks(dir, meta.name, defaults, opts);
  if (tasks.length === 0) {
    throw new ArenaError(
      `pack '${meta.name}' has no tasks — add tasks/<id>.json`, // nosemgrep: html-in-template-string
      "PACK_INVALID",
    );
  }
  return {
    name: meta.name,
    ...(meta.version !== undefined ? { version: meta.version } : {}),
    ...(meta.description !== undefined
      ? { description: meta.description }
      : {}),
    dir,
    tasks,
    defaults,
  };
}

// ─── Lint ────────────────────────────────────────────────────────────

/** Push one error line per schema issue of a tasks/<f> file. */
function pushTaskIssues(
  f: string,
  issues: z.ZodError["issues"],
  errors: string[],
): void {
  for (const i of issues) {
    errors.push(`tasks/${f} ${i.path.join(".") || "(root)"}: ${i.message}`);
  }
}

/** Validate a task's fixture field — appends to errors. */
function lintFixture(
  dir: string,
  id: string,
  fixture: string,
  errors: string[],
): void {
  const fx = resolve(dir, fixture);
  const rel = relative(dir, fx);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    errors.push(`task '${id}': fixture '${fixture}' escapes the pack dir`);
  } else if (!existsSync(fx) || !statSync(fx).isDirectory()) {
    errors.push(`task '${id}': fixture dir '${fixture}' does not exist`);
  }
}

/** Validate one parsed tasks/<id>.json — appends to errors/warnings. */
function lintTaskRaw(
  dir: string,
  f: string,
  raw: unknown,
  ids: Set<string>,
  errors: string[],
  warnings: string[],
): void {
  const parsed = packTaskSchema.safeParse(raw);
  if (!parsed.success) {
    pushTaskIssues(f, parsed.error.issues, errors);
    return;
  }
  const t = parsed.data;
  const id = t.id ?? basename(f, ".json");
  if (ids.has(id)) errors.push(`duplicate task id '${id}'`);
  ids.add(id);
  if (t.checks === undefined || t.checks.length === 0) {
    warnings.push(
      `task '${id}' has no checks — it scores on agent exit status only, not verification`,
    );
  }
  if (t.fixture !== undefined && t.repo !== undefined) {
    errors.push(
      `task '${id}': cannot specify both 'fixture' and 'repo' — choose one`,
    );
    return;
  }
  if (t.fixture === undefined) return;
  lintFixture(dir, id, t.fixture, errors);
}

/** Schema-check pack.json; warnings on name/dir mismatch. */
async function lintPackJson(
  dir: string,
): Promise<{ meta?: PackJson; errors: string[]; warnings: string[] }> {
  const packJsonPath = join(dir, "pack.json");
  if (!existsSync(packJsonPath)) {
    return { errors: [`no pack.json in '${dir}'`], warnings: [] };
  }
  try {
    const parsed = packJsonSchema.safeParse(
      JSON.parse(await readFile(packJsonPath, "utf8")),
    );
    if (!parsed.success) {
      return {
        errors: parsed.error.issues.map(
          (i) => `pack.json ${i.path.join(".") || "(root)"}: ${i.message}`,
        ),
        warnings: [],
      };
    }
    const warnings =
      parsed.data.name !== basename(dir)
        ? [
            `pack name '${parsed.data.name}' does not match directory '${basename(dir)}'`,
          ]
        : [];
    return { meta: parsed.data, errors: [], warnings };
  } catch (err) {
    return {
      errors: [
        `pack.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      ],
      warnings: [],
    };
  }
}

/**
 * Validate a pack directory without loading it into a run — collects
 * errors AND warnings instead of throwing on the first problem.
 */
export async function lintPack(dir: string): Promise<PackLint> {
  const meta = await lintPackJson(dir);
  const errors = [...meta.errors];
  const warnings = [...meta.warnings];
  if (meta.meta === undefined) return { errors, warnings };

  const tasksDir = join(dir, "tasks");
  if (!existsSync(tasksDir)) {
    errors.push(`no tasks/ directory in '${dir}'`);
    return { errors, warnings };
  }
  const files = (await readdir(tasksDir)).filter((f) => f.endsWith(".json"));
  if (files.length === 0) errors.push(`no tasks/*.json files in '${dir}'`);
  // File reads are independent — fanned out; findings stay in sorted
  // file order (parse/lint is CPU-only, so it runs after the reads).
  const raws = await Promise.all(
    files.sort().map(async (f) => {
      try {
        return {
          f,
          raw: JSON.parse(await readFile(join(tasksDir, f), "utf8")) as unknown,
        };
      } catch (err) {
        return { f, err };
      }
    }),
  );
  const ids = new Set<string>();
  for (const r of raws) {
    if ("err" in r) {
      errors.push(
        `tasks/${r.f}: not valid JSON: ${r.err instanceof Error ? r.err.message : String(r.err)}`,
      );
      continue;
    }
    lintTaskRaw(dir, r.f, r.raw, ids, errors, warnings);
  }
  return { errors, warnings };
}

// ─── Init scaffold ───────────────────────────────────────────────────

/** Scaffold a new pack at `<dir>` — `sverka-arena pack init <name>`. */
export async function initPack(dir: string, name: string): Promise<void> {
  if (existsSync(dir) && (await readdir(dir)).length > 0) {
    throw new ArenaError(
      `'${dir}' exists and is not empty — pick a fresh pack directory`,
      "PACK_INVALID",
    );
  }
  await mkdir(join(dir, "tasks"), { recursive: true });
  await writeFile(
    join(dir, "pack.json"),
    JSON.stringify(
      {
        name,
        version: "0.1.0",
        description: `${name} — sverka arena task pack`,
        defaults: { timeoutMs: 120_000, repetitions: 1, outputDir: ".arena" },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  await writeFile(
    join(dir, "tasks", "example-task.json"),
    JSON.stringify(
      {
        id: "example-task",
        name: "Example task",
        prompt:
          "Describe the task for the agent here. The score comes from the " +
          "checks below — deterministic verification, not an LLM judge.",
        checks: [
          {
            id: "example-check",
            command: "true",
            description:
              "replace with a real verification (e.g. npm test, sverka run)",
          },
        ],
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

// ─── Resolution ──────────────────────────────────────────────────────

function isGitUrl(ref: string): boolean {
  return (
    /^https?:\/\//.test(ref) ||
    ref.startsWith("git@") ||
    /^(?:ssh|git):\/\//.test(ref) ||
    ref.endsWith(".git")
  );
}

/**
 * Refresh a cached clone for reuse as a pack/fixture source. The tree
 * must come back pristine — callers copy the whole directory into run
 * workspaces (or load tasks from it). Fetch-then-reset, never
 * `pull --ff-only`: a dirty tree or a rewritten upstream makes every
 * later pull fail, wedging the cache until someone deletes it. Resetting
 * to `@{upstream}` resyncs instead — local edits and non-ff history are
 * discarded, never reused. `--prune` drops remote-tracking refs whose
 * upstream branch was deleted — without it `@{upstream}` would keep
 * resolving to the stale commit and the cache would silently serve it.
 */
async function refreshClone(dir: string, what: string): Promise<void> {
  const res = await git(["-C", dir, "fetch", "--prune", "origin"]);
  if (res.code !== 0) {
    throw new ArenaError(
      `cannot update ${what}: ${res.stderr.trim()}`,
      "PACK_NOT_FOUND",
    );
  }
  try {
    await gitOrThrow(["-C", dir, "reset", "--hard", "@{upstream}"]);
    // -f twice: one -f skips untracked dirs containing .git (nested
    // repos). -d -x: match a fresh clone — no untracked or ignored
    // files left behind.
    await gitOrThrow(["-C", dir, "clean", "-f", "-f", "-d", "-x"]);
  } catch (err) {
    throw new ArenaError(
      `cannot reset ${what} to upstream: ${err instanceof Error ? err.message : String(err)}`,
      "PACK_NOT_FOUND",
      err,
    );
  }
}

/**
 * Serialize clone/refresh per cache dir. loadTasks fans out with
 * Promise.allSettled, so two tasks sharing a `repo` URL — or concurrent
 * resolvePack calls on one pack URL — would otherwise race git writes
 * inside the same dest. Different dirs still run concurrently.
 */
const cloneChains = new Map<string, Promise<unknown>>();

function serializeClone<T>(dest: string, run: () => Promise<T>): Promise<T> {
  const prev = cloneChains.get(dest) ?? Promise.resolve();
  // catch(() => {}): a failed clone must not wedge the dir's chain.
  const next = prev.catch(() => {}).then(run);
  cloneChains.set(dest, next);
  const sweep = () => {
    if (cloneChains.get(dest) === next) cloneChains.delete(dest);
  };
  void next.then(sweep, sweep);
  return next;
}

async function cloneRepo(url: string, opts: LoadOptions): Promise<string> {
  const dest = join(
    opts.cacheDir ?? tmpdir(),
    `arena-pack-repo-${createHash("sha256").update(url).digest("hex").slice(0, 12)}`,
  );
  return serializeClone(dest, async () => {
    // The dest path is predictable (URL hash under a shared tmpdir) — a
    // foreign pre-created dir would supply its own .git/config, hooks,
    // and task commands running as us. Verify before any reuse.
    await ensurePrivateDir(dest, "repo clone cache", "PACK_NOT_FOUND");
    if (existsSync(join(dest, ".git"))) {
      await refreshClone(dest, `repo clone '${url}'`);
      return dest;
    }
    try {
      await gitOrThrow(["clone", "--depth", "1", url, dest]);
    } catch (err) {
      throw new ArenaError(
        `cannot clone task repo '${url}': ${err instanceof Error ? err.message : String(err)}`,
        "PACK_NOT_FOUND",
        err,
      );
    }
    return dest;
  });
}

async function clonePack(url: string, opts: LoadOptions): Promise<string> {
  const dest = join(
    opts.cacheDir ?? tmpdir(),
    `arena-pack-${createHash("sha256").update(url).digest("hex").slice(0, 12)}`,
  );
  return serializeClone(dest, async () => {
    await ensurePrivateDir(dest, "pack clone cache", "PACK_NOT_FOUND");
    if (existsSync(join(dest, ".git"))) {
      await refreshClone(dest, `pack clone '${url}'`);
      return dest;
    }
    try {
      await gitOrThrow(["clone", url, dest]);
    } catch (err) {
      throw new ArenaError(
        `cannot clone pack '${url}': ${err instanceof Error ? err.message : String(err)}`,
        "PACK_NOT_FOUND",
        err,
      );
    }
    return dest;
  });
}

export interface ResolvePackOptions extends LoadOptions {
  /** Registry ref for bare pack names (`packs/<name>/` inside it). */
  registry?: string;
  /** Bearer token for https git registries. */
  token?: string;
}

/**
 * Resolve a pack reference to a loaded {@link TaskPack}:
 *   <dir>          — a local pack directory
 *   <git-url>      — cloned into a tmp cache, then loaded
 *   <bare-name>    — packs/<name>/ inside --registry (file or git)
 */
export async function resolvePack(
  ref: string,
  opts: ResolvePackOptions = {},
): Promise<TaskPack> {
  // Local directory.
  if (existsSync(ref) && existsSync(join(ref, "pack.json"))) {
    return loadPack(resolve(ref), opts);
  }
  // Git URL.
  if (isGitUrl(ref) || ref.startsWith("git::")) {
    const url = ref.startsWith("git::") ? ref.slice(5) : ref;
    return loadPack(await clonePack(url, opts), opts);
  }
  // Bare name → packs/<name>/ inside the registry.
  const isBareName = /^[a-zA-Z0-9._-]+$/.test(ref); // nosemgrep: rules_lgpl_javascript_dos_rule-regex-dos
  if (isBareName) {
    if (opts.registry === undefined) {
      throw new ArenaError(
        `cannot resolve pack '${ref}' — no --registry given (packs live at packs/<name>/ inside a registry)`, // nosemgrep: html-in-template-string
        "PACK_NOT_FOUND",
      );
    }
    const regDir = await resolveRegistryDir(opts.registry, {
      ...(opts.token !== undefined ? { token: opts.token } : {}),
    });
    const packDir = join(regDir, "packs", ref);
    if (!existsSync(join(packDir, "pack.json"))) {
      throw new ArenaError(
        `pack '${ref}' not found at ${packDir}`,
        "PACK_NOT_FOUND",
      );
    }
    return loadPack(packDir, opts);
  }
  throw new ArenaError(`pack '${ref}' not found`, "PACK_NOT_FOUND");
}
