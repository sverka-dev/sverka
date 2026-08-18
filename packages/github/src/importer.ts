// GitHub Actions importer: parse .github/workflows/*.yml → Definition Graph.
// F-43 — reverse lowering. Spec §25.

import { parse as parseYaml } from "yaml";
import type { DefinitionGraph, ProjectDefinition, PipelineDefinition, StepDefinition, OperationDefinition, Dependency, EntryDefinition } from "@sverka/core";
import type { Trigger, Runtime } from "@sverka/cdk";
import { GithubTargetError } from "./errors.js";

/**
 * Diagnostic produced during import for unmappable constructs.
 */
export interface ImportDiagnostic {
  readonly severity: "info" | "warn" | "error";
  readonly message: string;
  readonly path?: string;
}

export interface ImportResult {
  readonly graph: DefinitionGraph;
  readonly diagnostics: readonly ImportDiagnostic[];
}

/**
 * Import a GitHub Actions workflow YAML string into a Definition Graph.
 * Lossy: unmappable constructs produce diagnostics.
 */
export function importGithub(source: string): DefinitionGraph {
  return importGithubWithDiagnostics(source).graph;
}

/**
 * Import a GitHub Actions workflow YAML string with diagnostics.
 */
export function importGithubWithDiagnostics(source: string): ImportResult {
  const diagnostics: ImportDiagnostic[] = [];
  let doc: Record<string, unknown>;

  try {
    doc = parseYaml(source) as Record<string, unknown>;
  } catch (err) {
    throw new GithubTargetError(
      `failed to parse GitHub workflow YAML: ${err instanceof Error ? err.message : String(err)}`,
      "IMPORT_FAILED",
    );
  }

  if (!doc || typeof doc !== "object") {
    throw new GithubTargetError("GitHub workflow YAML is not a valid object", "IMPORT_FAILED");
  }

  const projectId = "imported";
  const steps: StepDefinition[] = [];
  const entries: EntryDefinition[] = [];

  // Extract triggers from `on:`.
  const trigger = parseTrigger(doc.on, diagnostics);

  // Extract jobs → steps.
  const jobs = doc.jobs as Record<string, Record<string, unknown>> | undefined;
  if (jobs) {
    for (const [jobId, job] of Object.entries(jobs)) {
      steps.push(parseJob(jobId, job, diagnostics));
    }
  }

  // Create entry from trigger.
  if (steps.length > 0) {
    entries.push({ id: "ci/default", trigger, roots: steps.map((s) => s.id) });
  }

  const pipeline: PipelineDefinition = {
    id: "ci",
    inputs: {},
    entries,
    steps,
    outputs: [],
  };

  const project: ProjectDefinition = { id: projectId, pipelines: [pipeline] };

  return {
    graph: { project },
    diagnostics,
  };
}

/**
 * Parse the `on:` field of a GitHub workflow into a Sverka Trigger.
 */
function parseTrigger(onField: unknown, diagnostics: ImportDiagnostic[]): Trigger {
  if (typeof onField === "string") {
    return parseStringTrigger(onField);
  }
  if (onField && typeof onField === "object") {
    return parseObjectTrigger(onField as Record<string, unknown>, diagnostics);
  }
  return { kind: "push" };
}

function parseStringTrigger(onField: string): Trigger {
  if (onField === "push") return { kind: "push" };
  if (onField === "pull_request") return { kind: "changeRequest" };
  return { kind: "manual" };
}

function parseObjectTrigger(on: Record<string, unknown>, diagnostics: ImportDiagnostic[]): Trigger {
  if ("push" in on) return { kind: "push" };
  if ("pull_request" in on) return { kind: "changeRequest" };
  if ("workflow_dispatch" in on) return { kind: "manual" };
  if ("schedule" in on) {
    diagnostics.push({ severity: "info", message: "schedule trigger imported as manual" });
    return { kind: "manual" };
  }
  return { kind: "manual" };
}

/**
 * Parse a single GitHub job into a Sverka StepDefinition.
 */
function parseJob(jobId: string, job: Record<string, unknown>, diagnostics: ImportDiagnostic[]): StepDefinition {
  const stepId = `ci/${jobId}`;
  const operations: OperationDefinition[] = [];
  const dependencies: Dependency[] = [];

  // needs → dependencies.
  parseJobNeeds(job, dependencies);

  // steps → operations.
  const jobSteps = job.steps as readonly Record<string, unknown>[] | undefined;
  if (jobSteps) {
    for (const step of jobSteps) {
      parseJobStep(jobId, step, operations, diagnostics);
    }
  }

  // Unmappable constructs → diagnostics.
  recordJobDiagnostics(jobId, job, diagnostics);

  const runtime: Runtime = {};

  return {
    id: stepId,
    runtime,
    operations,
    inputs: [],
    outputs: [],
    dependencies,
  };
}

/**
 * Parse a job's `needs` field into dependencies.
 */
function parseJobNeeds(job: Record<string, unknown>, dependencies: Dependency[]): void {
  if (typeof job.needs === "string") {
    dependencies.push({ kind: "control", producer: `ci/${job.needs}` });
  } else if (Array.isArray(job.needs)) {
    for (const need of job.needs) {
      if (typeof need === "string") {
        dependencies.push({ kind: "control", producer: `ci/${need}` });
      }
    }
  }
}

/**
 * Parse a single GitHub step into one or more operations.
 */
function parseJobStep(
  jobId: string,
  step: Record<string, unknown>,
  operations: OperationDefinition[],
  diagnostics: ImportDiagnostic[],
): void {
  if (typeof step.run === "string") {
    operations.push({ kind: "shell", command: step.run });
    return;
  }
  if (typeof step.uses === "string") {
    parseUsesStep(jobId, step, step.uses, operations, diagnostics);
  }
}

/**
 * Parse a `uses:` step by dispatching to the appropriate action handler.
 */
function parseUsesStep(
  jobId: string,
  step: Record<string, unknown>,
  uses: string,
  operations: OperationDefinition[],
  diagnostics: ImportDiagnostic[],
): void {
  if (uses.includes("action-gh-release")) {
    operations.push(parseReleaseAction(step));
  } else if (uses.includes("upload-pages-artifact")) {
    operations.push(parseDeployPagesAction(step));
  } else if (uses.includes("actions/checkout")) {
    // Skip checkout — it's implicit in Sverka.
  } else if (uses.includes("actions/upload-artifact")) {
    operations.push(parseUploadArtifactAction(step));
  } else if (uses.includes("actions/download-artifact")) {
    parseDownloadArtifactAction(jobId, step, operations, diagnostics);
  } else {
    diagnostics.push({
      severity: "info",
      message: `unmapped action '${uses}' in job '${jobId}' — skipped`,
      path: jobId,
    });
  }
}

/**
 * Parse a release action (softprops/action-gh-release) into a release operation.
 */
function parseReleaseAction(step: Record<string, unknown>): OperationDefinition {
  const withMap = (step.with as Record<string, unknown> | undefined) ?? {};
  return {
    kind: "release",
    tag: typeof withMap.tag_name === "string" ? withMap.tag_name : "unknown",
    ...(typeof withMap.name === "string" ? { name: withMap.name } : {}),
    ...(typeof withMap.body === "string" ? { description: withMap.body } : {}),
    ...(typeof withMap.assets === "string"
      ? { assets: withMap.assets.split("\n").filter((s) => s.length > 0) }
      : {}),
    ...(typeof withMap.draft === "boolean" ? { draft: withMap.draft } : {}),
    ...(typeof withMap.prerelease === "boolean" ? { prerelease: withMap.prerelease } : {}),
  };
}

/**
 * Parse an upload-pages-artifact action into a deployPages operation.
 */
function parseDeployPagesAction(step: Record<string, unknown>): OperationDefinition {
  const withMap = (step.with as Record<string, unknown> | undefined) ?? {};
  return {
    kind: "deployPages",
    path: typeof withMap.path === "string" ? withMap.path : "dist/",
  };
  // Note: deploy-pages action usually follows; we skip it since
  // the deployPages operation covers both upload and deploy.
}

/**
 * Parse an actions/upload-artifact action into an exportArtifact operation.
 */
function parseUploadArtifactAction(step: Record<string, unknown>): OperationDefinition {
  const withMap = (step.with as Record<string, unknown> | undefined) ?? {};
  return {
    kind: "exportArtifact",
    name: typeof withMap.name === "string" ? withMap.name : "artifact",
    path: typeof withMap.path === "string" ? withMap.path : ".",
  };
}

/**
 * Parse an actions/download-artifact action into an importArtifact operation.
 */
function parseDownloadArtifactAction(
  jobId: string,
  step: Record<string, unknown>,
  operations: OperationDefinition[],
  diagnostics: ImportDiagnostic[],
): void {
  const withMap = (step.with as Record<string, unknown> | undefined) ?? {};
  const artifactName = typeof withMap.name === "string" ? withMap.name : "artifact";
  operations.push({
    kind: "importArtifact",
    name: artifactName,
    from: "ci/unknown",
    output: artifactName,
  });
  diagnostics.push({
    severity: "warn",
    message: `download-artifact in job '${jobId}' — 'from' may need manual correction`,
    path: jobId,
  });
}

/**
 * Record diagnostics for unmappable job-level constructs.
 */
function recordJobDiagnostics(jobId: string, job: Record<string, unknown>, diagnostics: ImportDiagnostic[]): void {
  if (job.strategy) {
    diagnostics.push({ severity: "warn", message: `job '${jobId}' has strategy/matrix — not imported`, path: jobId });
  }
  if (job.services) {
    diagnostics.push({ severity: "info", message: `job '${jobId}' has services — not imported`, path: jobId });
  }
  if (job.environment) {
    diagnostics.push({ severity: "info", message: `job '${jobId}' has environment — not imported`, path: jobId });
  }
}
