// GitLab CI importer: parse .gitlab-ci.yml → Definition Graph.
// F-43 — reverse lowering. Spec §25.

import { parse as parseYaml } from "yaml";
import type { DefinitionGraph, ProjectDefinition, PipelineDefinition, StepDefinition, OperationDefinition, Dependency, EntryDefinition } from "@sverka/core";
import type { Trigger, PipelineRule, Runtime } from "@sverka/cdk";
import { GitlabTargetError } from "./errors.js";

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
 * Import a GitLab CI YAML string into a Definition Graph.
 * Lossy: unmappable constructs produce diagnostics.
 */
export function importGitlab(source: string): DefinitionGraph {
  return importGitlabWithDiagnostics(source).graph;
}

/**
 * Import a GitLab CI YAML string with diagnostics for unmappable constructs.
 */
export function importGitlabWithDiagnostics(source: string): ImportResult {
  const diagnostics: ImportDiagnostic[] = [];
  let doc: Record<string, unknown>;

  try {
    doc = parseYaml(source) as Record<string, unknown>;
  } catch (err) {
    throw new GitlabTargetError(
      `failed to parse GitLab CI YAML: ${err instanceof Error ? err.message : String(err)}`,
      "IMPORT_FAILED",
    );
  }

  if (!doc || typeof doc !== "object") {
    throw new GitlabTargetError("GitLab CI YAML is not a valid object", "IMPORT_FAILED");
  }

  const projectId = "imported";
  const steps: StepDefinition[] = [];
  const entries: EntryDefinition[] = [];
  const pipelineRules: PipelineRule[] = [];

  // Extract workflow:rules.
  const workflow = doc.workflow as { rules?: readonly Record<string, unknown>[] } | undefined;
  if (workflow?.rules) {
    for (const rule of workflow.rules) {
      const pr: { if?: string; changes?: readonly string[]; exists?: readonly string[]; variables?: Record<string, string>; when?: "always" | "never" } = {};
      if (typeof rule.if === "string") pr.if = rule.if;
      if (Array.isArray(rule.changes)) pr.changes = rule.changes as readonly string[];
      if (Array.isArray(rule.exists)) pr.exists = rule.exists as readonly string[];
      if (rule.variables && typeof rule.variables === "object") {
        pr.variables = Object.fromEntries(
          Object.entries(rule.variables as Record<string, unknown>).filter(
            ([, v]) => typeof v === "string",
          ),
        ) as Record<string, string>;
      }
      if (rule.when === "always" || rule.when === "never") pr.when = rule.when;
      pipelineRules.push(pr);
    }
  }

  // Reserved top-level keys that are not jobs.
  const reservedKeys = new Set([
    "stages", "variables", "workflow", "include", "image",
    "before_script", "after_script", "cache", "services",
    "default",
  ]);

  // Extract jobs → steps.
  for (const [key, value] of Object.entries(doc)) {
    if (reservedKeys.has(key)) continue;
    if (!value || typeof value !== "object") continue;

    const job = value as Record<string, unknown>;
    const stepId = `ci/${key}`;
    const operations: OperationDefinition[] = [];
    const dependencies: Dependency[] = [];

    // script → shell operations.
    if (typeof job.script === "string") {
      operations.push({ kind: "shell", command: job.script });
    } else if (Array.isArray(job.script)) {
      for (const line of job.script) {
        if (typeof line === "string") {
          operations.push({ kind: "shell", command: line });
        }
      }
    }

    // needs → dependencies.
    if (Array.isArray(job.needs)) {
      for (const need of job.needs) {
        if (typeof need === "string") {
          dependencies.push({ kind: "control", producer: `ci/${need}` });
        } else if (need && typeof need === "object" && typeof (need as Record<string, unknown>).job === "string") {
          const needJob = (need as Record<string, unknown>).job as string;
          dependencies.push({ kind: "control", producer: `ci/${needJob}` });
        }
      }
    } else if (typeof job.needs === "string") {
      dependencies.push({ kind: "control", producer: `ci/${job.needs}` });
    }

    // trigger → downstream or child pipeline (simplified).
    if (job.trigger && typeof job.trigger === "object") {
      const trigger = job.trigger as Record<string, unknown>;
      if (typeof trigger.project === "string") {
        // Downstream project trigger.
        const dsInputs: Record<string, unknown> = {};
        if (trigger.inputs && typeof trigger.inputs === "object") {
          for (const [k, v] of Object.entries(trigger.inputs as Record<string, unknown>)) {
            dsInputs[k] = typeof v === "string" ? v : String(v);
          }
        }
        operations.push({
          kind: "diagnostic",
          message: `imported downstream trigger to project: ${trigger.project}`,
          severity: "info",
        });
        // We can't perfectly reconstruct the downstream step from operations,
        // but we record it as a diagnostic for now.
        diagnostics.push({
          severity: "warn",
          message: `job '${key}' has a downstream project trigger — imported as diagnostic. Manual reconstruction needed.`,
          path: key,
        });
      } else if (Array.isArray(trigger.include)) {
        diagnostics.push({
          severity: "warn",
          message: `job '${key}' has a child pipeline trigger — imported as diagnostic. Manual reconstruction needed.`,
          path: key,
        });
      }
    }

    // release → release operation.
    if (job.release && typeof job.release === "object") {
      const release = job.release as Record<string, unknown>;
      const assets = release.assets as { links?: readonly { name?: string; url?: string }[] } | undefined;
      operations.push({
        kind: "release",
        tag: typeof release.tag_name === "string" ? release.tag_name : "unknown",
        ...(typeof release.name === "string" ? { name: release.name } : {}),
        ...(typeof release.description === "string" ? { description: release.description } : {}),
        ...(assets?.links ? { assets: assets.links.map((l) => l.url ?? l.name ?? "unknown") } : {}),
      });
    }

    // pages → deployPages operation.
    if (job.pages && typeof job.pages === "object") {
      const pages = job.pages as Record<string, unknown>;
      operations.push({
        kind: "deployPages",
        path: typeof pages.publish === "string" ? pages.publish : "public/",
        ...(typeof pages.path_prefix === "string" ? { prefix: pages.path_prefix } : {}),
      });
    }

    // Unmappable constructs → diagnostics.
    if (job.cache) {
      diagnostics.push({ severity: "info", message: `job '${key}' has cache — not imported`, path: key });
    }
    if (job.services) {
      diagnostics.push({ severity: "info", message: `job '${key}' has services — not imported`, path: key });
    }
    if (job.matrix) {
      diagnostics.push({ severity: "warn", message: `job '${key}' has matrix — not imported`, path: key });
    }

    const runtime: Runtime =
      typeof job.image === "string"
        ? { mode: "container", image: job.image }
        : {};

    const step: StepDefinition = {
      id: stepId,
      runtime,
      operations,
      inputs: [],
      outputs: [],
      dependencies,
    };
    steps.push(step);
  }

  // Create a default entry if there are steps but no entries.
  if (steps.length > 0 && entries.length === 0) {
    const trigger: Trigger = { kind: "push" };
    entries.push({ id: "ci/default", trigger, roots: steps.map((s) => s.id) });
  }

  const pipeline: PipelineDefinition = {
    id: "ci",
    inputs: {},
    entries,
    steps,
    outputs: [],
    ...(pipelineRules.length > 0 ? { rules: pipelineRules } : {}),
  };

  const project: ProjectDefinition = { id: projectId, pipelines: [pipeline] };

  return {
    graph: { project },
    diagnostics,
  };
}
