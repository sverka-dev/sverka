// policy command — evaluate findings against policy.
// Spec 17 — §30.

import { DEFAULT_POLICY, evaluatePolicy } from "@sverka/policy";
import { loadBaseline, type Finding } from "@sverka/findings";
import type { GlobalFlags, OutputWriter } from "../types.js";
import { CliError, ExitCode } from "../types.js";
import { resolveUnderRoot } from "../internal/paths.js";

export interface PolicyArgs {
  baseline?: string;
}

/**
 * Evaluate findings against the default policy.
 * In v0, this is a placeholder — findings come from a baseline file
 * or are empty (no execution output to extract from yet).
 */
export async function policyCommand(
  args: PolicyArgs,
  global: GlobalFlags,
  output: OutputWriter,
  start: number,
): Promise<number> {
  output.debug(`policy: root=${global.root} baseline=${args.baseline ?? "(none)"}`);

  let findings: readonly Finding[] = [];
  let baselineFingerprints: readonly string[] = [];

  if (args.baseline) {
    const baselinePath = resolveUnderRoot(global.root, args.baseline);
    try {
      const baseline = await loadBaseline(baselinePath);
      baselineFingerprints = baseline.fingerprints;
      // In v0, the baseline stores fingerprints, not full findings.
      // The policy command with a baseline but no execution output
      // evaluates zero findings against the policy (all are known).
    } catch (e) {
      throw new CliError(
        `failed to load baseline: ${e instanceof Error ? e.message : String(e)}`,
        "SDK_ERROR",
        ExitCode.RuntimeError,
        e,
      );
    }
  }

  const result = evaluatePolicy(findings, DEFAULT_POLICY, [...baselineFingerprints]);

  const durationMs = Date.now() - start;
  if (global.format === "json") {
    output.writeLine(
      JSON.stringify({
        command: "policy",
        data: { verdict: result.verdict, summary: result.summary, triggered: result.triggered.length },
        durationMs,
      }),
    );
  } else {
    output.writeLine(`Policy: ${result.verdict}`);
    output.writeLine(`  ${result.summary}`);
  }

  return result.verdict === "pass" ? ExitCode.Success : ExitCode.PolicyFail;
}
