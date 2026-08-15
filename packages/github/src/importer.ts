// GitHub Actions importer: parse .github/workflows/*.yml → Definition Graph.
// F-43 — reverse lowering. Spec §25.

import { parse as parseYaml } from "yaml";
import type { DefinitionGraph, ProjectDefinition, PipelineDefinition, StepDefinition, OperationDefinition, Dependency, EntryDefinition } from "@sverka/core";
import type { Trigger, Runtime } from "@sverka/constructs";
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
  const onField = doc.on;
  let trigger: Trigger = { kind: "push" };
  if (typeof onField === "string") {
    if (onField === "push") trigger = { kind: "push" };
    else if (onField === "pull_request") trigger = { kind: "changeRequest" };
    else trigger = { kind: "manual" };
  } else if (onField && typeof onField === "object") {
    const on = onField as Record<string, unknown>;
    if ("push" in on) trigger = { kind: "push" };
    else if ("pull_request" in on) trigger = { kind: "changeRequest" };
    else if ("workflow_dispatch" in on) trigger = { kind: "manual" };
    else if ("schedule" in on) {
      trigger = { kind: "manual" };
      diagnostics.push({ severity: "info", message: "schedule trigger imported as manual" });
    }
  }

  // Extract jobs → steps.
  const jobs = doc.jobs as Record<string, Record<string, unknown>> | undefined;
  if (jobs) {
    for (const [jobId, job] of Object.entries(jobs)) {
      const stepId = `ci/${jobId}`;
      const operations: OperationDefinition[] = [];
      const dependencies: Dependency[] = [];

      // needs → dependencies.
      if (typeof job.needs === "string") {
        dependencies.push({ kind: "control", producer: `ci/${job.needs}` });
      } else if (Array.isArray(job.needs)) {
        for (const need of job.needs) {
          if (typeof need === "string") {
            dependencies.push({ kind: "control", producer: `ci/${need}` });
          }
        }
      }

      // steps → operations.
      const jobSteps = job.steps as readonly Record<string, unknown>[] | undefined;
      if (jobSteps) {
        for (const step of jobSteps) {
          if (typeof step.run === "string") {
            operations.push({ kind: "shell", command: step.run });
          } else if (typeof step.uses === "string") {
            // Map known actions.
            if (step.uses.includes("action-gh-release")) {
              const withMap = (step.with as Record<string, unknown> | undefined) ?? {};
              operations.push({
                kind: "release",
                tag: typeof withMap.tag_name === "string" ? withMap.tag_name : "unknown",
                ...(typeof withMap.name === "string" ? { name: withMap.name } : {}),
                ...(typeof withMap.body === "string" ? { description: withMap.body } : {}),
                ...(typeof withMap.assets === "string"
                  ? { assets: withMap.assets.split("\n").filter((s) => s.length > 0) }
                  : {}),
                ...(typeof withMap.draft === "boolean" ? { draft: withMap.draft } : {}),
                ...(typeof withMap.prerelease === "boolean" ? { prerelease: withMap.prerelease } : {}),
              });
            } else if (step.uses.includes("upload-pages-artifact")) {
              const withMap = (step.with as Record<string, unknown> | undefined) ?? {};
              operations.push({
                kind: "deployPages",
                path: typeof withMap.path === "string" ? withMap.path : "dist/",
              });
              // Note: deploy-pages action usually follows; we skip it since
              // the deployPages operation covers both upload and deploy.
            } else if (step.uses.includes("actions/checkout")) {
              // Skip checkout — it's implicit in Sverka.
            } else if (step.uses.includes("actions/upload-artifact")) {
              const withMap = (step.with as Record<string, unknown> | undefined) ?? {};
              operations.push({
                kind: "exportArtifact",
                name: typeof withMap.name === "string" ? withMap.name : "artifact",
                path: typeof withMap.path === "string" ? withMap.path : ".",
              });
            } else if (step.uses.includes("actions/download-artifact")) {
              const withMap = (step.with as Record<string, unknown> | undefined) ?? {};
              operations.push({
                kind: "importArtifact",
                name: typeof withMap.name === "string" ? withMap.name : "artifact",
                from: "ci/unknown",
                output: typeof withMap.path === "string" ? withMap.path : ".",
              });
              diagnostics.push({
                severity: "warn",
                message: `download-artifact in job '${jobId}' — 'from' may need manual correction`,
                path: jobId,
              });
            } else {
              // Unknown action → diagnostic.
              diagnostics.push({
                severity: "info",
                message: `unmapped action '${step.uses}' in job '${jobId}' — skipped`,
                path: jobId,
              });
            }
          }
        }
      }

      // Unmappable constructs → diagnostics.
      if (job.strategy) {
        diagnostics.push({ severity: "warn", message: `job '${jobId}' has strategy/matrix — not imported`, path: jobId });
      }
      if (job.services) {
        diagnostics.push({ severity: "info", message: `job '${jobId}' has services — not imported`, path: jobId });
      }
      if (job.environment) {
        diagnostics.push({ severity: "info", message: `job '${jobId}' has environment — not imported`, path: jobId });
      }

      const runtime: Runtime = {};
      if (typeof job["runs-on"] === "string") {
        // We don't map runs-on to anything specific in the portable model.
      }

      const stepDef: StepDefinition = {
        id: stepId,
        runtime,
        operations,
        inputs: [],
        outputs: [],
        dependencies,
      };
      steps.push(stepDef);
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
