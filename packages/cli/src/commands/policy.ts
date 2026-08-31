// policy command — evaluate findings against policy.
// Spec 17 — §30.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { DEFAULT_POLICY, evaluatePolicy } from "@sverka/verification";
import { loadBaseline, normalizeSarif } from "@sverka/verification";
import type { Finding, NormalizeContext, SarifLog } from "@sverka/verification";
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
  const raw = await loadFindingsFile(findingsPath);

  const ctx: NormalizeContext = {
    root: global.root,
    checkIdPrefix: "",
    defaultConfidence: 0.5,
  };
  const findings = normalizeFindings(raw, ctx);
  const baselineFingerprints = await loadBaselineFingerprints(global.root, args.baseline);

  const result = evaluatePolicy(findings, DEFAULT_POLICY, [...baselineFingerprints]);

  const durationMs = Date.now() - start;
  writePolicyOutput(result, global, output, durationMs);

  return result.verdict === "pass" ? ExitCode.Success : ExitCode.PolicyFail;
}

async function loadFindingsFile(findingsPath: string): Promise<unknown> {
  if (!existsSync(findingsPath)) {
    throw new CliError(
      `findings file not found: ${findingsPath}`,
      "MISSING_ARG",
      ExitCode.UsageError,
    );
  }
  try {
    return JSON.parse(await readFile(findingsPath, "utf8"));
  } catch (e) {
    throw new CliError(
      `failed to parse findings file: ${e instanceof Error ? e.message : String(e)}`,
      "SDK_ERROR",
      ExitCode.RuntimeError,
      e,
    );
  }
}

function normalizeFindings(raw: unknown, ctx: NormalizeContext): readonly Finding[] {
  try {
    return normalizeSarif(raw as SarifLog, ctx);
  } catch (e) {
    throw new CliError(
      `failed to normalize findings: ${e instanceof Error ? e.message : String(e)}`,
      "SDK_ERROR",
      ExitCode.RuntimeError,
      e,
    );
  }
}

async function loadBaselineFingerprints(
  root: string,
  baseline?: string,
): Promise<readonly string[]> {
  if (!baseline) return [];
  const baselinePath = resolveUnderRoot(root, baseline);
  try {
    const loaded = await loadBaseline(baselinePath);
    return loaded.fingerprints;
  } catch (e) {
    throw new CliError(
      `failed to load baseline: ${e instanceof Error ? e.message : String(e)}`,
      "SDK_ERROR",
      ExitCode.RuntimeError,
      e,
    );
  }
}

function writePolicyOutput(
  result: ReturnType<typeof evaluatePolicy>,
  global: GlobalFlags,
  output: OutputWriter,
  durationMs: number,
): void {
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
}
