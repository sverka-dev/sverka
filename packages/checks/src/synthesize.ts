// Check step synthesis — converts ProposedChecks into StepDefinitions.
// Spec 14 — §24, §25.

import type { StepDefinition } from "@sverka/core";
import type { ProposedCheck, ProjectContext } from "@sverka/planner";
import type { CheckResolver } from "./resolver.js";

/**
 * Convert proposed checks into StepDefinitions for inclusion in a
 * Definition Graph. Checks that fail resolution (resolver returns null)
 * are skipped. Duplicate checkIds are deduplicated — only the first
 * resolved check for each checkId is included.
 */
export function synthesizeCheckSteps(
  checks: readonly ProposedCheck[],
  ctx: ProjectContext,
  resolver: CheckResolver,
): readonly StepDefinition[] {
  const steps: StepDefinition[] = [];
  const seen = new Set<string>();

  for (const check of checks) {
    if (seen.has(check.checkId)) continue;
    const resolved = resolver.resolve(check, ctx);
    if (!resolved) continue;
    seen.add(resolved.checkId);
    steps.push(resolved.step);
  }

  return steps;
}
