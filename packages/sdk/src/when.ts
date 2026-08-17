// when() — condition helper.
// Spec 03 — §10 (StepDefinition.condition). In v0, conditions are
// boolean-producing References or Expressions. `when` is an identity
// function that marks a value as a condition for readability.

import type { Reference, Expression } from "@sverka/cdk";

/** Mark a reference or expression as a step condition. Returns it unchanged. */
export function when(ref: Reference | Expression): Reference | Expression {
  return ref;
}
