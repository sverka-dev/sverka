// @sverka/policy — public API. Spec 16.
export type { Verdict, Policy, FailOnRule, TriggeredFinding,
             RuleResult, PolicyResult, PolicyConfig } from "./types.js";
export { DEFAULT_POLICY, createPolicy } from "./policy.js";
export { evaluatePolicy } from "./evaluator.js";
export { verifyPolicyAgainstGraph } from "./verify.js";
export type { PolicyVerification } from "./verify.js";
export { PolicyError, type PolicyErrorCode } from "./errors.js";
