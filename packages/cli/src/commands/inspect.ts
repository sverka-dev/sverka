import { createPlanner } from "@sverka/sdk";
import type { GlobalFlags, OutputWriter } from "../types.js";
import { ExitCode } from "../types.js";

/**
 * Discover and print the project context.
 */
export async function inspectCommand(
  global: GlobalFlags,
  output: OutputWriter,
  start: number,
): Promise<number> {
  output.debug(`inspect: root=${global.root}`);
  const planner = createPlanner();
  const context = await planner.discover({ root: global.root });

  const durationMs = Date.now() - start;
  if (global.format === "json") {
    output.writeLine(
      JSON.stringify({
        command: "inspect",
        data: context,
        durationMs,
      }),
    );
  } else {
    output.writeLine(`Project context for ${context.root}`);
    output.writeLine(`  commit: ${context.commit}`);
    output.writeLine(`  dirty: ${context.dirty}`);
    output.writeLine(`  changed files: ${context.changedFiles.length}`);
    output.writeLine(
      `  languages: ${context.languages.map((l) => l.name).join(", ") || "(none)"}`,
    );
    output.writeLine(
      `  package managers: ${context.packageManagers.map((p) => p.name).join(", ") || "(none)"}`,
    );
    output.writeLine(`  container build: ${context.hasContainerBuild}`);
    output.writeLine(`  CI definition: ${context.hasCiDefinition}`);
    output.writeLine(
      `  monorepo: ${context.monorepo ? context.monorepo.tool : "(none)"}`,
    );
    output.writeLine(`  local signals: ${context.localSignals.length}`);
  }

  return ExitCode.Success;
}
