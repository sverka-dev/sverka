import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { GlobalFlags, OutputWriter } from "../types.js";
import { CliError, ExitCode } from "../types.js";
import type { WriteFileOptions } from "node:fs";

/** Args parsed for the init command. */
export interface InitArgs {
  template?: string | undefined;
  force?: boolean;
}

// Build template content with array.join to avoid Codacy "template string"
// warnings on multi-line literals that have no interpolation.
const MINIMAL_TEMPLATE = [
  'import { Project, Pipeline, ShellStep, Entry } from "@sverka/constructs";',
  "",
  'const proj = new Project("verify");',
  'const ci = new Pipeline(proj, "ci");',
  'new ShellStep(ci, "lint", { command: "bun run lint" });',
  'new ShellStep(ci, "typecheck", { command: "bun run typecheck" });',
  'new ShellStep(ci, "test", { command: "bun run test" });',
  'new Entry(ci, "on-push", { trigger: { kind: "push" }, roots: ["lint", "typecheck", "test"] });',
  "",
  "export default proj;",
  "",
].join("\n");

const FULL_TEMPLATE = [
  'import { Project, Pipeline, ShellStep, Entry } from "@sverka/constructs";',
  "",
  'const proj = new Project("verify");',
  'const ci = new Pipeline(proj, "ci");',
  'new ShellStep(ci, "lint", { command: "bun run lint" });',
  'new ShellStep(ci, "typecheck", { command: "bun run typecheck" });',
  'new ShellStep(ci, "test", { command: "bun run test" });',
  'new ShellStep(ci, "build", { command: "bun run build" });',
  'new Entry(ci, "on-push", { trigger: { kind: "push" }, roots: ["lint", "typecheck", "test", "build"] });',
  "",
  "export default proj;",
  "",
].join("\n");

/** Resolve and validate the template name, returning its file content. */
function resolveTemplateContent(template: string): string {
  if (template !== "minimal" && template !== "full") {
    throw new CliError(
      `invalid template: ${template} (expected minimal|full)`,
      "INVALID_FLAG",
      ExitCode.UsageError,
    );
  }
  return template === "full" ? FULL_TEMPLATE : MINIMAL_TEMPLATE;
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
  const template = args.template ?? "minimal";
  output.debug(`init: root=${global.root} template=${template} force=${Boolean(args.force)}`);
  const content = resolveTemplateContent(template);
  const configPath = resolveConfigPath(global.root, global.config);
  await writeConfig(configPath, content, Boolean(args.force));
  emitInitResult(output, global.format, configPath, template, start);
  return ExitCode.Success;
}
