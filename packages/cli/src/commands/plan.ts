import { createSverka } from "@sverka/sdk";
import type { GlobalFlags, OutputWriter } from "../types.js";
import { ExitCode } from "../types.js";
import { resolveUnderRoot } from "../internal/paths.js";

/** Args parsed for the plan command. */
export interface PlanArgs {
  onlyNew?: boolean;
}
/**
 * Run SDK plan() and print the PlanResult. Does not execute checks.
 */
export async function planCommand(
  args: PlanArgs,
  global: GlobalFlags,
  output: OutputWriter,
  start: number,
): Promise<number> {
  output.debug(`plan: root=${global.root} onlyNew=${Boolean(args.onlyNew)}`);
  const sverka = createSverka({
    root: global.root,
    // Resolve a relative --config against --root (matches auto-discovery).
    ...(global.config
      ? { configPath: resolveUnderRoot(global.root, global.config) }
      : {}),
    // Forward onlyNew to the SDK. plan() currently has no findings to filter
    // (check providers arrive in wave 11), so this is a forward-compatible
    // no-op until then — but the flag is no longer silently dropped.
    onlyNew: Boolean(args.onlyNew),
  });
  const result = await sverka.plan();

  const durationMs = Date.now() - start;
  if (global.format === "json") {
    output.writeLine(
      JSON.stringify({
        command: "plan",
        data: result,
        durationMs,
      }),
    );
  } else {
    output.writeLine(`Plan for ${result.context.root}`);
    output.writeLine(`  operations: ${result.operations.length}`);
    if (result.proposal) {
      output.writeLine(`  proposed checks: ${result.proposal.checks.length}`);
      for (const check of result.proposal.checks) {
        output.writeLine(`    - ${check.checkId} (priority: ${check.priority})`);
      }
    } else {
      output.writeLine("  proposal: (from config)");
    }
  }

  return ExitCode.Success;
}
