// Shared helpers for CI target lowering (github/ + gitlab/).
import type { StepDefinition } from "@sverka/workflow";

/**
 * Build a mapping from full step IDs (e.g., "ci/lint") to CI-safe
 * job IDs (e.g., "lint"). If there are collisions, append a suffix.
 */
export function buildJobIdMap(
  steps: readonly StepDefinition[],
): Map<string, string> {
  const map = new Map<string, string>();
  const used = new Set<string>();

  for (const step of steps) {
    // Use the last segment of the path as the job ID.
    const shortId = step.id.includes("/") ? step.id.split("/").pop()! : step.id;
    let jobId = shortId;
    let suffix = 1;
    while (used.has(jobId)) {
      jobId = `${shortId}-${suffix}`;
      suffix++;
    }
    used.add(jobId);
    map.set(step.id, jobId);
  }

  return map;
}
