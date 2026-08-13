// when() — condition reference helper.
// Spec 03 — §10 (StepDefinition.condition). In v0, conditions are
// boolean-producing References. `when` is an identity function that marks
// a reference as a condition for readability.

import type { Reference } from "@sverka/constructs";

/** Mark a reference as a step condition. Returns the reference unchanged. */
export function when(ref: Reference): Reference {
  return ref;
}
