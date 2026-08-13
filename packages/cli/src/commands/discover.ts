// discover command — run planner discovery, show project context.
// Spec 17 — §30.

import { createPlanner } from "@sverka/planner";
import type { GlobalFlags, OutputWriter } from "../types.js";
import { ExitCode } from "../types.js";

/**
 * Discover project context and display it.
 */
export async function discoverCommand(
  global: GlobalFlags,
  output: OutputWriter,
  start: number,
): Promise<number> {
  output.debug(`discover: root=${global.root}`);

  const planner = createPlanner();
  const ctx = await planner.discover({ root: global.root });

  const durationMs = Date.now() - start;
  if (global.format === "json") {
    output.writeLine(
      JSON.stringify({
        command: "discover",
        data: {
          root: ctx.root,
          commit: ctx.commit,
          dirty: ctx.dirty,
          languages: ctx.languages,
          packageManagers: ctx.packageManagers,
          hasContainerBuild: ctx.hasContainerBuild,
          hasCiDefinition: ctx.hasCiDefinition,
          monorepo: ctx.monorepo,
          changedFiles: ctx.changedFiles.length,
        },
        durationMs,
      }),
    );
  } else {
    output.writeLine(`Project: ${ctx.root}`);
    output.writeLine(`  commit: ${ctx.commit || "(none)"}`);
    output.writeLine(`  dirty: ${ctx.dirty}`);
    output.writeLine(`  languages: ${ctx.languages.map((l) => l.name).join(", ") || "(none)"}`);
    output.writeLine(`  package managers: ${ctx.packageManagers.map((p) => p.name).join(", ") || "(none)"}`);
    output.writeLine(`  container build: ${ctx.hasContainerBuild}`);
    output.writeLine(`  CI definition: ${ctx.hasCiDefinition}`);
    if (ctx.monorepo) {
      output.writeLine(`  monorepo: ${ctx.monorepo.tool} (${ctx.monorepo.workspaces.length} workspaces)`);
    }
    output.writeLine(`  changed files: ${ctx.changedFiles.length}`);
  }

  return ExitCode.Success;
}
