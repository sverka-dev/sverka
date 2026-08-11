import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
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
  'import { defineWorkflow, pipeline, task, run } from "@sverka/sdk";',
  "",
  "export default defineWorkflow({",
  '  name: "verify",',
  "  workflow: pipeline(",
  '    task("lint", run({ command: "bun", args: ["run", "lint"] })),',
  '    task("typecheck", run({ command: "bun", args: ["run", "typecheck"] })),',
  '    task("test", run({ command: "bun", args: ["run", "test"] })),',
  "  ),",
  "});",
  "",
].join("\n");

const FULL_TEMPLATE = [
  'import { defineWorkflow, pipeline, task, run } from "@sverka/sdk";',
  "",
  "export default defineWorkflow({",
  '  name: "verify",',
  "  workflow: pipeline(",
  '    task("lint", run({ command: "bun", args: ["run", "lint"] })),',
  '    task("typecheck", run({ command: "bun", args: ["run", "typecheck"] })),',
  '    task("test", run({ command: "bun", args: ["run", "test"] })),',
  '    task("build", run({ command: "bun", args: ["run", "build"] })),',
  "  ),",
  "});",
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

/** Write the config file, using exclusive create when not forcing. */
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
  const configPath = join(global.root, "sverka.config.ts");
  await writeConfig(configPath, content, Boolean(args.force));
  emitInitResult(output, global.format, configPath, template, start);
  return ExitCode.Success;
}
