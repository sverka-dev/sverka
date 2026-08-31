// Check step synthesis — converts ProposedChecks into ResolvedChecks.
// Spec 14 — §24, §25.

import type { StepDefinition } from "@sverka/workflow";
import type { ProposedCheck, ProjectContext } from "@sverka/workflow";
import type { CheckResolver, ResolvedCheck } from "./resolver.js";

/**
 * Convert proposed checks into ResolvedChecks for inclusion in a
 * Definition Graph. Checks that fail resolution (resolver returns null)
 * are skipped. Duplicate checkIds are deduplicated — only the first
 * resolved check for each checkId is included. The resolver's
 * `outputs` metadata is preserved alongside the generated step.
 */
export function synthesizeCheckSteps(
  checks: readonly ProposedCheck[],
  ctx: ProjectContext,
  resolver: CheckResolver,
): readonly ResolvedCheck[] {
  const result: ResolvedCheck[] = [];
  const seen = new Set<string>();

  for (const check of checks) {
    const resolved = resolver.resolve(check, ctx);
    if (!resolved) continue;
    if (seen.has(resolved.checkId)) continue;
    seen.add(resolved.checkId);

    const step: StepDefinition = {
      ...resolved.step,
      id: `checks/${resolved.checkId}`,
    };
    result.push({ ...resolved, step });
  }

  return result;
}
