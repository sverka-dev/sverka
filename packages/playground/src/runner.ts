// @sverka/playground — pipeline runner. Browser-safe.
// Executes FunctionSteps and collects findings.

import type { Project } from "./pipeline.js";
import type { Pipeline } from "./pipeline.js";
import type { Step } from "./pipeline.js";
import type { Finding, PlaygroundFinding, PipelineResult, StepResult } from "./types.js";

/** Simple deterministic hash for fingerprint generation. Browser-safe. */
function simpleHash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Convert a PlaygroundFinding to a full Finding with fingerprint and id. */
function toFinding(pf: PlaygroundFinding, stepId: string): Finding {
  // Include checkId (stepId) in fingerprint so identical findings from
  // different checks get distinct fingerprints.
  const fingerprintInput = `${stepId}:${pf.rule}:${pf.file}:${pf.line}`;
  const fingerprint = simpleHash(fingerprintInput);
  const id = `${stepId}:${fingerprint}`;
  return {
    id,
    fingerprint,
    checkId: stepId,
    severity: pf.severity,
    confidence: 0.8,
    message: pf.message,
    rule: pf.rule,
    file: pf.file,
    startLine: pf.line,
    endLine: pf.line,
    source: {
      tool: pf.tool ?? stepId,
      version: null,
      format: "custom",
      originalRuleId: pf.rule,
      originalSeverity: null,
    },
    ...(pf.snippet ? { snippet: pf.snippet } : {}),
  };
}

/** Execute a single step and return its result. */
async function executeStep(step: Step): Promise<StepResult> {
  const start = Date.now();
  try {
    const playgroundFindings = await step.execute();
    const findings = playgroundFindings.map((pf) => toFinding(pf, step.id));
    return {
      stepId: step.id,
      status: "success",
      findings,
      durationMs: Date.now() - start,
    };
  } catch (e) {
    return {
      stepId: step.id,
      status: "failure",
      findings: [],
      durationMs: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Run all FunctionSteps in a project's pipelines and collect findings.
 * Browser-safe — no Node.js APIs, no child_process, no fs.
 *
 * If a pipeline has entries with `roots`, only steps whose id matches a
 * root are executed. If no entries exist or all entries have empty roots,
 * all steps run.
 */
export async function runPipeline(project: Project): Promise<PipelineResult> {
  const start = Date.now();
  const stepResults: StepResult[] = [];
  const allFindings: Finding[] = [];

  for (const pipeline of project.pipelines) {
    // Determine which steps to run based on entry roots.
    let stepsToRun = pipeline.steps;
    const entriesWithRoots = pipeline.entries.filter((e) => e.roots.length > 0);
    if (entriesWithRoots.length > 0) {
      const rootSet = new Set<string>();
      for (const entry of entriesWithRoots) {
        for (const root of entry.roots) rootSet.add(root);
      }
      stepsToRun = pipeline.steps.filter((s) => rootSet.has(s.id));
    }

    // Execute all selected steps in parallel — dependencies are for
    // ordering, not data flow in the playground.
    const results = await Promise.all(
      stepsToRun.map((step) => executeStep(step)),
    );

    for (const result of results) {
      stepResults.push(result);
      allFindings.push(...result.findings);
    }
  }

  return {
    steps: stepResults,
    findings: allFindings,
    totalDurationMs: Date.now() - start,
    success: stepResults.every((s) => s.status === "success"),
  };
}
