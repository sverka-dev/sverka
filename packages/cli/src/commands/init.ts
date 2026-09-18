import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { GlobalFlags, OutputWriter } from "../types.js";
import { CliError, ExitCode } from "../types.js";
import type { WriteFileOptions } from "node:fs";
import { detectPackageManager, ensureConstructsDependency } from "../internal/config.js";
import type { PmName } from "../internal/config.js";
import { createPlanner } from "@sverka/sdk";
import { createBuiltinResolver, synthesizeCheckSteps } from "@sverka/verification";

/** Args parsed for the init command. */
export interface InitArgs {
  template?: string | undefined;
  force?: boolean;
  detect?: boolean;
}

function buildMinimalTemplate(pm: PmName): string {
  return [
    'import { Project, Pipeline, ShellStep, Entry } from "@sverka/workflow";',
    "",
    'const proj = new Project("verify");',
    'const ci = new Pipeline(proj, "ci");',
    `new ShellStep(ci, "lint", { command: "${pm} run lint" });`,
    `new ShellStep(ci, "typecheck", { command: "${pm} run typecheck" });`,
    `new ShellStep(ci, "test", { command: "${pm} run test" });`,
    'new Entry(ci, "on-push", { trigger: { kind: "push" }, roots: ["lint", "typecheck", "test"] });',
    "",
    "export default proj;",
    "",
  ].join("\n");
}

function buildFullTemplate(pm: PmName): string {
  return [
    'import { Project, Pipeline, ShellStep, Entry } from "@sverka/workflow";',
    "",
    'const proj = new Project("verify");',
    'const ci = new Pipeline(proj, "ci");',
    `new ShellStep(ci, "lint", { command: "${pm} run lint" });`,
    `new ShellStep(ci, "typecheck", { command: "${pm} run typecheck" });`,
    `new ShellStep(ci, "test", { command: "${pm} run test" });`,
    `new ShellStep(ci, "build", { command: "${pm} run build" });`,
    'new Entry(ci, "on-push", { trigger: { kind: "push" }, roots: ["lint", "typecheck", "test", "build"] });',
    "",
    "export default proj;",
    "",
  ].join("\n");
}

/** package.json script names that map to pipeline steps for --detect. */
const DETECT_SCRIPT_CHECKS = [
  "lint",
  "typecheck",
  "test",
  "build",
  "format",
  "check",
] as const;

/**
 * Read package.json scripts under root. Returns an empty map when absent or
 * malformed. Ground truth for JS/TS projects.
 */
function readPackageScripts(root: string): Record<string, string> {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      scripts?: Record<string, unknown>;
    };
    const scripts = pkg.scripts ?? {};
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(scripts)) {
      if (typeof value === "string" && value.length > 0) out[name] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** The known check script names that exist in package.json. */
function detectPackageJsonChecks(root: string): string[] {
  const scripts = readPackageScripts(root);
  return DETECT_SCRIPT_CHECKS.filter((name) => name in scripts);
}

/**
 * True when the planner-proposed command is a package-manager script
 * invocation (`<pm> run <script>`) whose script does not exist — a phantom
 * step that would fail with "Missing script" on first run.
 */
function isPhantomScriptStep(command: string, root: string): boolean {
  const m = /^(?:bun|npm|pnpm|yarn|deno)\s+run\s+([A-Za-z0-9:_-]+)/.exec(
    command.trim(),
  );
  if (m === null) return false;
  return !(m[1]! in readPackageScripts(root));
}

/** Build a config from detected checks using the planner + resolver + package.json scripts. */
async function buildDetectedTemplate(root: string): Promise<string | null> {
  const pm = detectPackageManager(root);
  const stepLines: string[] = [];
  const rootIds: string[] = [];

  // Planner-based detection covers non-npm ecosystems (cargo, go, ruff).
  // It requires a git repository — degrade gracefully when unavailable.
  try {
    const planner = createPlanner();
    const ctx = await planner.discover({ root });
    const proposal = await planner.plan(ctx);
    if (proposal.checks.length > 0) {
      const resolver = createBuiltinResolver();
      const resolved = synthesizeCheckSteps(proposal.checks, ctx, resolver);
      for (const r of resolved) {
        const shellOp = r.step.operations.find((o) => o.kind === "shell");
        const command = shellOp?.kind === "shell" ? shellOp.command : "";
        // Planner proposes checks by ecosystem, not by package.json scripts —
        // drop `<pm> run <script>` steps for scripts that don't exist.
        if (isPhantomScriptStep(command, root)) continue;
        const checkId = JSON.stringify(r.checkId);
        const sarifOut = r.outputs.find((o) => o.format === "sarif");
        rootIds.push(r.checkId);
        if (sarifOut !== undefined) {
          const outputsDecl =
            "{ " +
            JSON.stringify(sarifOut.path) +
            ': { type: "artifact", fromStdout: true } }';
          stepLines.push(
            `new ShellStep(ci, ${checkId}, { command: ${JSON.stringify(command)}, outputs: ${outputsDecl} });`,
          );
        } else {
          stepLines.push(
            `new ShellStep(ci, ${checkId}, { command: ${JSON.stringify(command)} });`,
          );
        }
      }
    }
  } catch {
    // discovery unavailable (e.g. not a git repo) — script checks still apply
  }

  // Emit a step for every known check script present in package.json that
  // detection did not already cover.
  for (const name of detectPackageJsonChecks(root)) {
    if (rootIds.includes(name)) continue;
    rootIds.push(name);
    stepLines.push(
      `new ShellStep(ci, ${JSON.stringify(name)}, { command: ${JSON.stringify(`${pm} run ${name}`)} });`,
    );
  }

  if (stepLines.length === 0) return null;

  const rootList = rootIds.map((id) => JSON.stringify(id)).join(", ");

  return [
    'import { Project, Pipeline, ShellStep, Entry, push } from "@sverka/workflow";',
    "",
    'const proj = new Project("verify");',
    'const ci = new Pipeline(proj, "ci");',
    ...stepLines,
    `new Entry(ci, "on-push", { trigger: push(), roots: [${rootList}] });`,
    "",
    "export default proj;",
    "",
  ].join("\n");
}

/** Resolve and validate the template name, returning its file content. */
function resolveTemplateContent(template: string, pm: PmName): string {
  if (template !== "minimal" && template !== "full") {
    throw new CliError(
      `invalid template: ${template} (expected minimal|full)`,
      "INVALID_FLAG",
      ExitCode.UsageError,
    );
  }
  return template === "full" ? buildFullTemplate(pm) : buildMinimalTemplate(pm);
}

/** Write the config file, creating parent directories and using exclusive create when not forcing. */
async function writeConfig(
  configPath: string,
  content: string,
  force: boolean,
): Promise<void> {
  if (existsSync(configPath) && !force) {
    throw new CliError(
      `config already exists: ${configPath} (use --force to overwrite)`,
      "CONFIG_EXISTS",
      ExitCode.UsageError,
    );
  }
  // Use exclusive create (wx) when not forcing to close the TOCTOU race
  // between existsSync and writeFile. With --force, use standard write.
  const flags: WriteFileOptions = force ? "utf8" : { encoding: "utf8", flag: "wx" };
  try {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, content, flags);
  } catch (e) {
    if (
      e instanceof Error &&
      "code" in e &&
      (e as { code: string }).code === "EEXIST"
    ) {
      throw new CliError(
        `config already exists: ${configPath} (use --force to overwrite)`,
        "CONFIG_EXISTS",
        ExitCode.UsageError,
        e,
      );
    }
    throw e;
  }
}

/** Emit the init result in the requested output format. */
function emitInitResult(
  output: OutputWriter,
  format: GlobalFlags["format"],
  configPath: string,
  template: string,
  start: number,
): void {
  if (format === "json") {
    output.writeLine(
      JSON.stringify({
        command: "init",
        data: { path: configPath, template },
        durationMs: Date.now() - start,
      }),
    );
  } else {
    output.writeLine(`Created ${configPath} (template: ${template})`);
  }
}

/** Resolve the config path relative to root, honoring an explicit --config. */
function resolveConfigPath(root: string, config: string | null): string {
  const defaultPath = "sverka.config.ts";
  const selected = config ?? defaultPath;
  return isAbsolute(selected) ? selected : join(root, selected);
}

/**
 * Create a sverka.config.ts in the root directory.
 */
export async function initCommand(
  args: InitArgs,
  global: GlobalFlags,
  output: OutputWriter,
  start: number,
): Promise<number> {
  const configPath = resolveConfigPath(global.root, global.config);

  // Fail fast if the config already exists and --force is not set before any
  // persistent side effects (e.g. mutating package.json) are applied.
  if (existsSync(configPath) && !args.force) {
    throw new CliError(
      `config already exists: ${configPath} (use --force to overwrite)`,
      "CONFIG_EXISTS",
      ExitCode.UsageError,
    );
  }

  let content: string;
  let template: string;

  if (args.detect) {
    output.debug(`init: root=${global.root} detect=true force=${Boolean(args.force)}`);
    const detected = await buildDetectedTemplate(global.root);
    if (detected !== null) {
      content = detected;
      template = "detect";
    } else {
      output.debug("init: detection found no checks, falling back to minimal template");
      const pm = detectPackageManager(global.root);
      content = buildMinimalTemplate(pm);
      template = "minimal";
    }
  } else {
    template = args.template ?? "minimal";
    const pm = detectPackageManager(global.root);
    output.debug(`init: root=${global.root} template=${template} pm=${pm} force=${Boolean(args.force)}`);
    content = resolveTemplateContent(template, pm);
  }

  const declared = await ensureConstructsDependency(global.root);
  if (declared === null) {
    output.errorLine(
      "note: could not resolve @sverka/workflow — the generated config imports it; install it (e.g. bun add -d @sverka/workflow) before running sverka",
    );
  }
  await writeConfig(configPath, content, Boolean(args.force));
  emitInitResult(output, global.format, configPath, template, start);
  return ExitCode.Success;
}
