import { existsSync } from "node:fs";
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

/** Build a config from detected checks using the planner + resolver. */
async function buildDetectedTemplate(root: string): Promise<string | null> {
  const planner = createPlanner();
  const ctx = await planner.discover({ root });
  const proposal = await planner.plan(ctx);
  if (proposal.checks.length === 0) return null;

  const resolver = createBuiltinResolver();
  const resolved = synthesizeCheckSteps(proposal.checks, ctx, resolver);
  if (resolved.length === 0) return null;

  const stepLines = resolved.map((r) => {
    const shellOp = r.step.operations.find((o) => o.kind === "shell");
    const command = shellOp?.kind === "shell" ? shellOp.command : "";
    const checkId = r.checkId;
    const sarifOut = r.outputs.find((o) => o.format === "sarif");
    if (sarifOut !== undefined) {
      return `new ShellStep(ci, "${checkId}", { command: "${command}", outputs: { "${sarifOut.path}": { type: "artifact", fromStdout: true } } });`;
    }
    return `new ShellStep(ci, "${checkId}", { command: "${command}" });`;
  });

  const rootIds = resolved.map((r) => r.checkId);

  return [
    'import { Project, Pipeline, ShellStep, Entry, push } from "@sverka/workflow";',
    "",
    'const proj = new Project("verify");',
    'const ci = new Pipeline(proj, "ci");',
    ...stepLines,
    `new Entry(ci, "on-push", { trigger: push(), roots: [${rootIds.map((id) => `"${id}"`).join(", ")}] });`,
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

  await ensureConstructsDependency(global.root);
  await writeConfig(configPath, content, Boolean(args.force));
  emitInitResult(output, global.format, configPath, template, start);
  return ExitCode.Success;
}
