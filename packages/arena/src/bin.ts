#!/usr/bin/env node
/**
 * sverka-arena — CLI for the agent arena: run the benchmark matrix, render
 * saved results, check the environment, publish to the results registry
 * and render the leaderboard. Specs: 49-arena-cli, 56-arena-eval-service.
 */

import process from "node:process";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

import type { ArenaResult } from "./types.js";
import { ArenaError, loadArenaConfig, resolveAdapter } from "./config.js";
import { renderReport } from "./report.js";
import { writeAggregateReport } from "./aggregate-report.js";
import { runArena } from "./runner.js";
import {
  openRegistry,
  reindexRegistry,
  type ArenaRegistry,
} from "./registry.js";
import { publishFile, publishResult } from "./publish.js";
import { buildBoard, renderBoard, renderBoardHtml } from "./board.js";
import { initPack, lintPack, resolvePack, type TaskPack } from "./pack.js";

interface Io {
  out(s: string): void;
  err(s: string): void;
}

type Format = "text" | "json" | "html";

interface ParsedArgs {
  command: string | undefined;
  positional: string[];
  config: string;
  configSet: boolean;
  out: string | undefined;
  format: Format;
  tasks: string[];
  pack: string | undefined;
  registry: string | undefined;
  agent: string | undefined;
  sverkaVersion: string | undefined;
  since: string | undefined;
  dir: string | undefined;
  traces: string[];
  publish: boolean;
}

const USAGE = `usage: sverka-arena <command> [options]

commands:
  run      [--config <path>] [--out <dir>] [--format json|text] [--task <id>]...
           [--pack <ref>] [--publish --registry <ref>]
  report   <results.json>               [--format json|text|html] [--out <file.html>]
  doctor   [--config <path>]            [--format json|text]
  publish  <results.json> --pack <name> --registry <ref>
           [--config <path>] [--agent <id>] [--sverka-version <v>] [--trace <file>]...
           [--format json|text]
  board    --registry <ref> [--pack <name>] [--agent <id>] [--since <date>]
           [--format json|text|html] [--out <file.html>]
  pack     init <name> [--dir <parent>] | lint <dir> [--format json|text]
  reindex  --registry <ref>             [--format json|text]

registry refs: <dir> | file://<dir> | <git-url> | git::<url> | s3://<bucket>/<prefix>
pack refs:     <dir> | <git-url> | <name> (packs/<name>/ inside --registry)
env:           ARENA_REGISTRY (registry ref), ARENA_REGISTRY_TOKEN (https bearer)
`;

function flagValue(argv: readonly string[], i: number): string {
  const val = argv[i + 1];
  if (val === undefined || val.startsWith("--")) {
    throw new ArenaError(`${argv[i]} requires a value`, "CONFIG_INVALID");
  }
  return val;
}

function parseFormat(val: string): Format {
  if (val !== "json" && val !== "text" && val !== "html") {
    throw new ArenaError(`invalid --format '${val}'`, "CONFIG_INVALID");
  }
  return val;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  let config = "arena.config.ts";
  let configSet = false;
  let out: string | undefined;
  let format: "text" | "json" | "html" = "text";
  let command: string | undefined;
  const tasks: string[] = [];
  const traces: string[] = [];
  let pack: string | undefined;
  let registry: string | undefined;
  let agent: string | undefined;
  let sverkaVersion: string | undefined;
  let since: string | undefined;
  let dir: string | undefined;
  let publish = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--config":
        config = flagValue(argv, i);
        configSet = true;
        i += 1;
        break;
      case "--out":
        out = flagValue(argv, i);
        i += 1;
        break;
      case "--format":
        format = parseFormat(flagValue(argv, i));
        i += 1;
        break;
      case "--task":
        tasks.push(flagValue(argv, i));
        i += 1;
        break;
      case "--pack":
        pack = flagValue(argv, i);
        i += 1;
        break;
      case "--registry":
        registry = flagValue(argv, i);
        i += 1;
        break;
      case "--agent":
        agent = flagValue(argv, i);
        i += 1;
        break;
      case "--sverka-version":
        sverkaVersion = flagValue(argv, i);
        i += 1;
        break;
      case "--since":
        since = flagValue(argv, i);
        i += 1;
        break;
      case "--dir":
        dir = flagValue(argv, i);
        i += 1;
        break;
      case "--trace":
        traces.push(flagValue(argv, i));
        i += 1;
        break;
      case "--publish":
        publish = true;
        break;
      default:
        if (arg.startsWith("--")) {
          throw new ArenaError(`unknown option '${arg}'`, "CONFIG_INVALID");
        }
        if (command === undefined) command = arg;
        else positional.push(arg);
    }
  }
  return {
    command,
    positional,
    config,
    configSet,
    out,
    format,
    tasks,
    pack,
    registry,
    agent,
    sverkaVersion,
    since,
    dir,
    traces,
    publish,
  };
}

function which(bin: string): boolean {
  const exts =
    process.platform === "win32"
      ? ["", ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")]
      : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (exts.some((ext) => existsSync(join(dir, bin + ext)))) return true;
  }
  return false;
}

async function cmdReport(args: ParsedArgs, io: Io): Promise<number> {
  const file = args.positional[0];
  if (file === undefined) {
    io.err("report: missing <results.json> path");
    return 2;
  }
  let result: ArenaResult;
  try {
    result = JSON.parse(await readFile(file, "utf8")) as ArenaResult;
  } catch (err) {
    io.err(
      `report: cannot read '${file}': ${err instanceof Error ? err.message : String(err)}`,
    );
    return 2;
  }
  if (
    !Array.isArray(result.aggregates) ||
    !Array.isArray(result.analysis) ||
    !Array.isArray(result.results) ||
    result.config === undefined ||
    !Array.isArray(result.config.models)
  ) {
    io.err(`report: '${file}' is not a sverka-arena results file\n`);
    return 2;
  }
  if (args.format === "json") {
    io.out(JSON.stringify(result, null, 2) + "\n");
  } else if (args.format === "html") {
    const out = args.out ?? "arena-report.html";
    writeAggregateReport(result, resolve(out), {
      command: `sverka-arena report ${file} --format html`,
    });
    io.out(`report written to ${out}\n`);
  } else {
    io.out(renderReport(result) + "\n");
  }
  return 0;
}

/** Filter config tasks by --task ids; duplicate ids collapse to one. */
export function filterTasks<T extends { id: string }>(
  tasks: T[],
  ids: string[],
): { tasks: T[] } | { missing: string[] } {
  const seen = new Set<string>();
  const uniq = tasks.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
  if (ids.length === 0) return { tasks: uniq };
  const known = new Set(uniq.map((t) => t.id));
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length > 0) return { missing };
  const wanted = new Set(ids);
  return { tasks: uniq.filter((t) => wanted.has(t.id)) };
}

/** Version of @sverka/arena itself — the sverkaVersion stamp on docs. */
function arenaVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function registryRef(args: ParsedArgs): string | undefined {
  return args.registry ?? process.env["ARENA_REGISTRY"];
}

/**
 * Strip embedded credentials (scheme://user:pass@host) before a registry
 * ref is printed to stderr — CI logs retain that output. Exported for
 * tests.
 */
export function redactRegistryRef(ref: string): string {
  return ref.replace(/(\/\/)[^/\s]+@/, "$1***@");
}

/** POSIX single-quote escaping — `'`, with `'\''` per embedded quote. */
function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * The `sverka-arena publish` retry hint printed when `run --publish`
 * fails — args are shell-quoted so the line survives a copy-paste. A
 * --registry ref carrying embedded credentials is never echoed (even
 * redacted it is unusable); the user re-supplies it via ARENA_REGISTRY.
 * Exported for tests.
 */
export function publishRetryHint(opts: {
  saved: string;
  pack: string;
  agent: string;
  sverkaVersion: string;
  config?: string;
  registry?: string;
}): string {
  const retry = [
    `sverka-arena publish ${shQuote(opts.saved)}`,
    `--pack ${shQuote(opts.pack)}`,
    `--agent ${shQuote(opts.agent)}`,
    `--sverka-version ${shQuote(opts.sverkaVersion)}`,
  ];
  if (opts.config !== undefined) retry.push(`--config ${shQuote(opts.config)}`);
  let note = "";
  if (opts.registry !== undefined) {
    if (redactRegistryRef(opts.registry) === opts.registry) {
      retry.push(`--registry ${shQuote(opts.registry)}`);
    } else {
      note =
        "\nnote: the registry ref carries credentials — set ARENA_REGISTRY to the original ref before retrying";
    }
  }
  return `retry with: ${retry.join(" ")}${note}`;
}

/** Bearer token for private https registries — env only, never argv. */
function registryToken(): string | undefined {
  return process.env["ARENA_REGISTRY_TOKEN"];
}

function registryOpts(): { token?: string } {
  const token = registryToken();
  return token !== undefined ? { token } : {};
}

function requireRegistry(args: ParsedArgs): ArenaRegistry {
  const ref = registryRef(args);
  if (ref === undefined) {
    throw new ArenaError(
      "no registry — pass --registry <ref> or set ARENA_REGISTRY",
      "CONFIG_INVALID",
    );
  }
  return openRegistry(ref, registryOpts());
}

async function cmdRun(args: ParsedArgs, io: Io): Promise<number> {
  if (args.format === "html") {
    io.err("run: --format html is only supported by 'report'\n");
    return 2;
  }
  // Fail fast — a missing registry must fail before the matrix runs.
  const publishRegistry = args.publish ? requireRegistry(args) : undefined;
  let pack: TaskPack | undefined;
  let config: Awaited<ReturnType<typeof loadArenaConfig>>;
  if (args.pack !== undefined) {
    const regRef = registryRef(args);
    pack = await resolvePack(args.pack, {
      ...(regRef !== undefined ? { registry: regRef } : {}),
      ...registryOpts(),
    });
    io.err(
      `pack '${pack.name}': ${pack.tasks.length} task(s) from ${pack.dir}\n`,
    );
    const configExists = existsSync(resolve(args.config));
    if (configExists || args.configSet) {
      config = await loadArenaConfig(args.config);
      config.tasks = pack.tasks as typeof config.tasks;
      if (
        config.repetitions === undefined &&
        pack.defaults.repetitions !== undefined
      ) {
        config.repetitions = pack.defaults.repetitions;
      }
    } else {
      // No config — synthesize a minimal one so shared packs run standalone.
      config = {
        agent: resolveAdapter("devin"),
        models: [{ id: "devin-default", name: "Devin default" }],
        plugins: [],
        tasks: pack.tasks as typeof config.tasks,
        outputDir: resolve(pack.defaults.outputDir ?? ".arena"),
        ...(pack.defaults.repetitions !== undefined
          ? { repetitions: pack.defaults.repetitions }
          : {}),
      };
    }
  } else {
    config = await loadArenaConfig(args.config);
  }
  if (args.out !== undefined) config.outputDir = resolve(args.out);
  const filtered = filterTasks(config.tasks, args.tasks);
  if ("missing" in filtered) {
    io.err(
      `run: unknown --task '${filtered.missing.join("', '")}' (config defines: ${[...new Set(config.tasks.map((t) => t.id))].join(", ")})\n`,
    );
    return 2;
  }
  config.tasks = filtered.tasks;
  const result = await runArena(config);
  if (args.format === "json") {
    io.out(JSON.stringify(result, null, 2) + "\n");
  } else {
    io.out(renderReport(result) + "\n");
  }
  if (publishRegistry !== undefined) {
    // Resolved once so a publish retry stamps the same version — pinning
    // it keeps the run in its original comparison cohort.
    const sverkaVersion = args.sverkaVersion ?? arenaVersion();
    try {
      const paths = await publishResult(result, publishRegistry, {
        pack: pack?.name ?? "default",
        agent: config.agent.id,
        sverkaVersion,
        prompts: Object.fromEntries(
          config.tasks.map((t) => [t.id, t.prompt] as const),
        ),
      });
      for (const p of paths) io.err(`published ${p}\n`);
    } catch (err) {
      // The matrix already ran — point at the saved results.json so the
      // user can retry `sverka-arena publish` without re-running it.
      // An env-sourced registry ref is inherited on retry; an explicit
      // ref is echoed only when it carries no credentials.
      const saved = join(config.outputDir, "results.json");
      io.err(
        `publish failed — results saved at ${saved}\n` +
          publishRetryHint({
            saved,
            pack: pack?.name ?? "default",
            agent: config.agent.id,
            sverkaVersion,
            ...(args.configSet ? { config: args.config } : {}),
            ...(args.registry !== undefined ? { registry: args.registry } : {}),
          }) +
          "\n",
      );
      throw err;
    }
  }
  return 0;
}

// ─── publish ─────────────────────────────────────────────────────────

async function cmdPublish(args: ParsedArgs, io: Io): Promise<number> {
  const file = args.positional[0];
  if (file === undefined) {
    io.err("publish: missing <results.json> path\n");
    return 2;
  }
  const registry = requireRegistry(args);

  let raw: { schema?: string; results?: unknown };
  try {
    raw = JSON.parse(await readFile(resolve(file), "utf8")) as typeof raw;
  } catch (err) {
    io.err(
      `publish: cannot read '${file}': ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }
  const isMatrix =
    typeof raw === "object" &&
    raw !== null &&
    raw.schema !== "arena.result/v1" &&
    Array.isArray(raw.results);

  // Matrix files need pack+agent context; v1 docs carry their own.
  // --agent may still come from a config file's `agent` field.
  let agent = args.agent;
  const prompts: Record<string, string> = {};
  if (existsSync(resolve(args.config))) {
    try {
      const cfg = await loadArenaConfig(args.config);
      agent ??= cfg.agent.id;
      for (const t of cfg.tasks) prompts[t.id] = t.prompt;
    } catch {
      /* config optional for publish */
    }
  }
  if (isMatrix && (args.pack === undefined || agent === undefined)) {
    io.err(
      `publish: matrix results.json requires --pack <name> and --agent <id> (or --config with an agent)\n`,
    );
    return 2;
  }
  const paths = await publishFile(file, registry, {
    pack: args.pack ?? "default",
    agent: agent ?? "unknown",
    sverkaVersion: args.sverkaVersion ?? arenaVersion(),
    prompts,
    traces: args.traces,
  });
  if (args.format === "json") {
    io.out(JSON.stringify({ published: paths }, null, 2) + "\n");
  } else {
    for (const p of paths) io.out(`published ${p}\n`);
  }
  return 0;
}

// ─── board ───────────────────────────────────────────────────────────

async function cmdBoard(args: ParsedArgs, io: Io): Promise<number> {
  const registry = requireRegistry(args);
  const results = await registry.list({
    ...(args.pack !== undefined ? { pack: args.pack } : {}),
    ...(args.agent !== undefined ? { agent: args.agent } : {}),
    ...(args.since !== undefined ? { since: args.since } : {}),
  });
  const cohorts = buildBoard(results);
  if (args.format === "json") {
    io.out(JSON.stringify(cohorts, null, 2) + "\n");
  } else if (args.format === "html") {
    const out = args.out ?? "arena-board.html";
    writeFileSync(resolve(out), renderBoardHtml(cohorts), "utf8");
    io.out(`leaderboard written to ${out}\n`);
  } else {
    io.out(renderBoard(cohorts) + "\n");
  }
  return 0;
}

// ─── pack ────────────────────────────────────────────────────────────

async function cmdPack(args: ParsedArgs, io: Io): Promise<number> {
  const sub = args.positional[0];
  if (sub === "init") {
    const name = args.positional[1];
    if (name === undefined) {
      io.err("pack init: missing <name>\n");
      return 2;
    }
    const dir = join(args.dir ?? process.cwd(), name);
    await initPack(dir, name);
    io.out(`pack '${name}' scaffolded at ${dir}\n`);
    return 0;
  }
  if (sub === "lint") {
    const dir = args.positional[1];
    if (dir === undefined) {
      io.err("pack lint: missing <dir>\n");
      return 2;
    }
    const { errors, warnings } = await lintPack(resolve(dir));
    if (args.format === "json") {
      io.out(JSON.stringify({ errors, warnings }, null, 2) + "\n");
    } else {
      for (const w of warnings) io.out(`warn  ${w}\n`);
      for (const e of errors) io.out(`error ${e}\n`);
      if (errors.length === 0) io.out(`pack '${dir}': ok\n`);
    }
    return errors.length === 0 ? 0 : 1;
  }
  io.err(`pack: unknown subcommand '${sub ?? ""}' — init|lint\n`);
  return 2;
}

// ─── reindex ─────────────────────────────────────────────────────────

async function cmdReindex(args: ParsedArgs, io: Io): Promise<number> {
  const registry = requireRegistry(args);
  const { runs } = await reindexRegistry(registry);
  if (args.format === "json") {
    io.out(JSON.stringify({ runs }, null, 2) + "\n");
  } else {
    io.out(`index.json rebuilt — ${runs} run(s) indexed\n`);
  }
  return 0;
}

interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

function doctorChecks(
  config: Awaited<ReturnType<typeof loadArenaConfig>>,
): DoctorCheck[] {
  const agentOnPath = which(config.agent.id);
  const checks: DoctorCheck[] = [
    {
      name: `agent binary: ${config.agent.id}`,
      ok: agentOnPath,
      detail: agentOnPath ? "on PATH" : "not found on PATH",
    },
  ];
  const models = config.judge
    ? [...config.models, config.judge.model]
    : config.models;
  for (const m of models) {
    if (m.envVar === undefined) continue;
    checks.push({
      name: `env: ${m.envVar} (model ${m.id})`,
      ok: process.env[m.envVar] !== undefined,
      detail: process.env[m.envVar] !== undefined ? "set" : "not set",
    });
  }
  return checks;
}

async function cmdDoctor(args: ParsedArgs, io: Io): Promise<number> {
  if (args.format === "html") {
    io.err("doctor: --format html is only supported by 'report'\n");
    return 2;
  }
  const checks = doctorChecks(await loadArenaConfig(args.config));

  if (args.format === "json") {
    io.out(JSON.stringify({ checks }, null, 2) + "\n");
  } else {
    for (const chk of checks) {
      io.out(`${chk.ok ? "ok" : "FAIL"}  ${chk.name} — ${chk.detail}\n`);
    }
  }
  return checks.every((chk) => chk.ok) ? 0 : 1;
}

const defaultIo: Io = {
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
};

/** Entry point — exported for tests; bin calls it with process.argv. */
export async function main(
  argv: readonly string[],
  io: Io = defaultIo,
): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    io.err((err instanceof Error ? err.message : String(err)) + "\n");
    io.err(USAGE);
    return 2;
  }

  if (args.command === undefined) {
    io.err(USAGE);
    return 2;
  }

  try {
    switch (args.command) {
      case "run":
        return await cmdRun(args, io);
      case "report":
      case "doctor":
        if (args.tasks.length > 0) {
          io.err(`${args.command}: --task is only supported by 'run'\n`);
          return 2;
        }
        return args.command === "report"
          ? await cmdReport(args, io)
          : await cmdDoctor(args, io);
      case "publish":
        return await cmdPublish(args, io);
      case "board":
        return await cmdBoard(args, io);
      case "pack":
        return await cmdPack(args, io);
      case "reindex":
        return await cmdReindex(args, io);
      default:
        io.err(`unknown command '${args.command}'\n`);
        io.err(USAGE);
        return 2;
    }
  } catch (err) {
    if (err instanceof ArenaError) {
      const code =
        err.code === "REGISTRY_UNAVAILABLE" || err.code === "PUBLISH_CONFLICT"
          ? 3
          : 2;
      io.err(`error: ${err.message}\n`);
      if (err.cause !== undefined) {
        io.err(
          `cause: ${err.cause instanceof Error ? err.cause.message : String(err.cause)}\n`,
        );
      }
      return code;
    }
    io.err(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 3;
  }
}

// Run when invoked directly (not imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  const code = await main(process.argv.slice(2));
  process.exit(code);
}
