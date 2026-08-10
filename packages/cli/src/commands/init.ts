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

const MINIMAL_TEMPLATE = `import { defineWorkflow, pipeline, task, run } from "@sverka/sdk";

export default defineWorkflow({
  name: "verify",
  workflow: pipeline(
    task("lint", run({ command: "bun", args: ["run", "lint"] })),
    task("typecheck", run({ command: "bun", args: ["run", "typecheck"] })),
    task("test", run({ command: "bun", args: ["run", "test"] })),
  ),
});
`;

const FULL_TEMPLATE = `import { defineWorkflow, pipeline, task, run } from "@sverka/sdk";

export default defineWorkflow({
  name: "verify",
  workflow: pipeline(
    task("lint", run({ command: "bun", args: ["run", "lint"] })),
    task("typecheck", run({ command: "bun", args: ["run", "typecheck"] })),
    task("test", run({ command: "bun", args: ["run", "test"] })),
    task("build", run({ command: "bun", args: ["run", "build"] })),
  ),
});
`;

/**
 * Create a sverka.config.ts in the root directory.
 */
export async function initCommand(
  args: InitArgs,
  global: GlobalFlags,
  output: OutputWriter,
  start: number,
): Promise<number> {
  output.debug(`init: root=${global.root} template=${args.template ?? "minimal"} force=${Boolean(args.force)}`);
  const template = args.template ?? "minimal";
  if (template !== "minimal" && template !== "full") {
    throw new CliError(
      `invalid template: ${template} (expected minimal|full)`,
      "INVALID_FLAG",
      ExitCode.UsageError,
    );
  }

  const configPath = join(global.root, "sverka.config.ts");
  if (existsSync(configPath) && !args.force) {
    throw new CliError(
      `config already exists: ${configPath} (use --force to overwrite)`,
      "CONFIG_EXISTS",
      ExitCode.UsageError,
    );
  }

  const content = template === "full" ? FULL_TEMPLATE : MINIMAL_TEMPLATE;
  // Use exclusive create (wx) when not forcing to close the TOCTOU race
  // between existsSync and writeFile. With --force, use standard write.
  const flags: WriteFileOptions = args.force ? "utf8" : { encoding: "utf8", flag: "wx" };
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

  if (global.format === "json") {
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

  return ExitCode.Success;
}
