// status() factory — creates a StatusCondition for step conditions.
// F-11 — §conditions.

import type { StepStatus, StatusCondition } from "@sverka/workflow";

/**
 * Create a status-based condition.
 * @example
 * sh`notify-slack`.condition(status("failure"))
 */
export function status(s: StepStatus): StatusCondition {
  return { kind: "status", status: s };
}
