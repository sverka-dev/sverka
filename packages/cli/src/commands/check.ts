// check command — detect project checks and show proposed steps.
// Spec 17 — §30.

import type { GlobalFlags, OutputWriter } from "../types.js";
import { ExitCode } from "../types.js";
import { detectProjectChecks } from "../internal/detect.js";

/**
 * Discover project checks (planner + package.json scripts) and display the
 * steps they would become — the same detection `init --detect` uses.
 */
export async function checkCommand(
  global: GlobalFlags,
  output: OutputWriter,
  start: number,
): Promise<number> {
  output.debug(`check: root=${global.root}`);

  const checks = await detectProjectChecks(global.root);

  const durationMs = Date.now() - start;
  if (global.format === "json") {
    output.writeLine(
      JSON.stringify({
        command: "check",
        data: {
          proposed: checks.map((c) => c.checkId),
          resolved: checks.map((c) => ({ id: c.checkId, command: c.command })),
        },
        durationMs,
      }),
    );
  } else {
    output.writeLine(`Proposed checks: ${checks.length}`);
    for (const c of checks) {
      output.writeLine(`  - ${c.checkId} (${c.source}): ${c.command}`);
    }
  }

  return ExitCode.Success;
}
