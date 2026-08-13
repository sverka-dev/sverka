// policy command — evaluate findings against policy.
// Spec 17 — §30.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { DEFAULT_POLICY, evaluatePolicy } from "@sverka/policy";
import { loadBaseline, normalizeSarif } from "@sverka/findings";
import type { Finding, NormalizeContext, SarifLog } from "@sverka/findings";
import type { GlobalFlags, OutputWriter } from "../types.js";
import { CliError, ExitCode } from "../types.js";
import { resolveUnderRoot } from "../internal/paths.js";

export interface PolicyArgs {
  findings: string;
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
  output.debug(`policy: root=${global.root} findings=${args.findings} baseline=${args.baseline ?? "(none)"}`);

  const findingsPath = resolveUnderRoot(global.root, args.findings);
  if (!existsSync(findingsPath)) {
    throw new CliError(
      `findings file not found: ${findingsPath}`,
      "MISSING_ARG",
      ExitCode.UsageError,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(findingsPath, "utf8"));
  } catch (e) {
    throw new CliError(
      `failed to parse findings file: ${e instanceof Error ? e.message : String(e)}`,
      "SDK_ERROR",
      ExitCode.RuntimeError,
      e,
    );
  }

  const ctx: NormalizeContext = {
    root: global.root,
    checkIdPrefix: "",
    defaultConfidence: 0.5,
  };

  let findings: readonly Finding[];
  try {
    findings = normalizeSarif(raw as SarifLog, ctx);
  } catch (e) {
    throw new CliError(
      `failed to normalize findings: ${e instanceof Error ? e.message : String(e)}`,
      "SDK_ERROR",
      ExitCode.RuntimeError,
      e,
    );
  }

  let baselineFingerprints: readonly string[] = [];
  if (args.baseline) {
    const baselinePath = resolveUnderRoot(global.root, args.baseline);
    try {
      const baseline = await loadBaseline(baselinePath);
      baselineFingerprints = baseline.fingerprints;
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
