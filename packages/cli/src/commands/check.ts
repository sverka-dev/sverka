// check command — resolve proposed checks → StepDefinitions, display.
// Spec 17 — §30.

import { createPlanner } from "@sverka/sdk";
import { createBuiltinResolver, synthesizeCheckSteps } from "@sverka/verification";
import type { OperationDefinition } from "@sverka/workflow";
import type { GlobalFlags, OutputWriter } from "../types.js";
import { ExitCode } from "../types.js";

function getShellCommand(ops: readonly OperationDefinition[]): string {
  const op = ops.find((o) => o.kind === "shell");
  return op?.kind === "shell" ? op.command : "n/a";
}

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
          proposed: proposal.checks.map((c: { checkId: string }) => c.checkId),
          resolved: steps.map((s) => ({ id: s.step.id, command: getShellCommand(s.step.operations) })),
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
    for (const resolved of steps) {
      output.writeLine(`  - ${resolved.step.id}: ${getShellCommand(resolved.step.operations)}`);
    }
  }

  return ExitCode.Success;
}
