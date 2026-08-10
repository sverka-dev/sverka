// @sverka/policy — public API
export type {
  Verdict,
  Policy,
  FailOnRule,
  TriggeredFinding,
  RuleResult,
  PolicyResult,
  PolicyConfig,
} from "./types.js";
export { DEFAULT_POLICY, createPolicy } from "./policy.js";
export { evaluatePolicy } from "./evaluator.js";
export { PolicyError, type PolicyErrorCode } from "./errors.js";
