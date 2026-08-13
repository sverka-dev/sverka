// check command — resolve proposed checks → StepDefinitions, display.
// Spec 17 — §30.

import { createPlanner } from "@sverka/planner";
import { createBuiltinResolver, synthesizeCheckSteps } from "@sverka/checks";
import type { GlobalFlags, OutputWriter } from "../types.js";
import { ExitCode } from "../types.js";

/**
 * Discover project, plan proposed checks, resolve to StepDefinitions.
 */
export async function checkCommand(
  global: GlobalFlags,
  output: OutputWriter,
  start: number,
): Promise<number> {
  output.debug(`check: root=${global.root}`);

  const planner = createPlanner();
  const ctx = await planner.discover({ root: global.root });
  const proposal = await planner.plan(ctx);
  const resolver = createBuiltinResolver();
  const steps = synthesizeCheckSteps(proposal.checks, ctx, resolver);

  const durationMs = Date.now() - start;
  if (global.format === "json") {
    output.writeLine(
      JSON.stringify({
        command: "check",
        data: {
          proposed: proposal.checks.map((c) => c.checkId),
          resolved: steps.map((s) => ({ id: s.id, command: (s.operations[0] as { command: string }).command })),
        },
        durationMs,
      }),
    );
  } else {
    output.writeLine(`Proposed checks: ${proposal.checks.length}`);
    for (const check of proposal.checks) {
      output.writeLine(`  - ${check.checkId} (priority: ${check.priority})`);
    }
    output.writeLine(`Resolved steps: ${steps.length}`);
    for (const step of steps) {
      const cmd = (step.operations[0] as { command: string }).command;
      output.writeLine(`  - ${step.id}: ${cmd}`);
    }
  }

  return ExitCode.Success;
}
