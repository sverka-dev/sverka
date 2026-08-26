// when() — condition helper.
// Spec 03 — §10 (StepDefinition.condition). In v0, conditions are
// boolean-producing References, Expressions, or StatusConditions. `when` is
// an identity function that marks a value as a condition for readability.

import type { Condition } from "@sverka/cdk";

/** Mark a reference, expression, or status condition as a step condition. Returns it unchanged. */
export function when(cond: Condition): Condition {
  return cond;
}
