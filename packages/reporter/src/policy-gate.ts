// @sverka/reporter — PolicyGate (pure). Spec 43.

import { evaluatePolicy, DEFAULT_POLICY } from "@sverka/verification";
import type { PolicyGateOptions, PolicyGateResult } from "./types.js";

/** Evaluate the policy gate. Returns the result and appropriate exit code. */
export function evaluateGate(options: PolicyGateOptions): PolicyGateResult {
  const policy = options.policy ?? DEFAULT_POLICY;
  const baselineFingerprints = options.baselineFingerprints ?? [];
  const result = evaluatePolicy(
    [...options.findings],
    policy,
    [...baselineFingerprints],
  );
  return {
    result,
    exitCode: result.verdict === "pass" ? 0 : 1,
  };
}
