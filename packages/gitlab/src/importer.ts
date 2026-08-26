// GitLab CI importer: parse .gitlab-ci.yml → Definition Graph.
// F-43 — reverse lowering. Spec §25.

import { parse as parseYaml } from "yaml";
import type { DefinitionGraph, ProjectDefinition, PipelineDefinition, StepDefinition, OperationDefinition, Dependency, EntryDefinition } from "@sverka/core";
import type { Trigger, PipelineRule, Runtime, Rule } from "@sverka/cdk";
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
  const doc = parseGitlabDoc(source);

  const projectId = "imported";
  const steps: StepDefinition[] = [];
  const entries: EntryDefinition[] = [];
  const pipelineRules: PipelineRule[] = [];

  extractWorkflowRules(doc, pipelineRules);

  const reservedKeys = new Set([
    "stages", "variables", "workflow", "include", "image",
    "before_script", "after_script", "cache", "services",
    "default",
  ]);

  for (const [key, value] of Object.entries(doc)) {
    if (reservedKeys.has(key)) continue;
    // Skip hidden jobs (dot-prefixed keys like .base) — they are templates, not executable.
    if (key.startsWith(".")) continue;
    if (!value || typeof value !== "object") continue;
    const step = convertJobToStep(key, value as Record<string, unknown>, diagnostics);
    steps.push(step);
  }

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

/**
 * Parse and validate the GitLab CI YAML source into a record.
 */
function parseGitlabDoc(source: string): Record<string, unknown> {
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
  return doc;
}

/**
 * Extract workflow:rules into pipeline rules.
 */
function extractWorkflowRules(doc: Record<string, unknown>, pipelineRules: PipelineRule[]): void {
  const workflow = doc.workflow as { rules?: readonly Record<string, unknown>[] } | undefined;
  if (!workflow?.rules) return;
  for (const rule of workflow.rules) {
    pipelineRules.push(convertWorkflowRule(rule));
  }
}

/**
 * Extract string variables from a rule's `variables` field.
 */
function extractRuleVariables(rule: Record<string, unknown>): Record<string, string> | undefined {
  if (rule.variables && typeof rule.variables === "object") {
    return Object.fromEntries(
      Object.entries(rule.variables as Record<string, unknown>).filter(
        ([, v]) => typeof v === "string",
      ),
    ) as Record<string, string>;
  }
  return undefined;
}

function convertWorkflowRule(rule: Record<string, unknown>): PipelineRule {
  const pr: { if?: string; changes?: readonly string[]; exists?: readonly string[]; variables?: Record<string, string>; when?: "always" | "never" } = {};
  if (typeof rule.if === "string") pr.if = rule.if;
  if (Array.isArray(rule.changes)) pr.changes = rule.changes as readonly string[];
  if (Array.isArray(rule.exists)) pr.exists = rule.exists as readonly string[];
  const variables = extractRuleVariables(rule);
  if (variables) pr.variables = variables;
  if (rule.when === "always" || rule.when === "never") pr.when = rule.when;
  return pr;
}

/**
 * Convert a single GitLab job into a StepDefinition.
 */
function convertJobToStep(
  key: string,
  job: Record<string, unknown>,
  diagnostics: ImportDiagnostic[],
): StepDefinition {
  const stepId = `ci/${key}`;
  const operations: OperationDefinition[] = [];
  const dependencies: Dependency[] = [];

  convertScript(job, operations);
  convertNeeds(job, dependencies);
  convertTrigger(key, job, operations, diagnostics);
  convertRelease(job, operations);
  convertPages(job, operations);
  convertArtifacts(job, operations);
  recordUnmappableConstructs(key, job, diagnostics);

  const runtime: Runtime =
    typeof job.image === "string"
      ? { mode: "container", image: job.image }
      : {};

  // Job-level rules → StepDefinition.rules
  const rules = convertJobRules(job);

  // Job-level before_script/after_script
  const beforeScript = convertScriptArray(job, "before_script");
  const afterScript = convertScriptArray(job, "after_script");

  // when: delayed + start_in → delay
  const delay = convertDelay(job);

  return {
    id: stepId,
    runtime,
    operations,
    inputs: [],
    outputs: [],
    dependencies,
    ...(rules.length > 0 ? { rules } : {}),
    ...(beforeScript !== undefined ? { beforeScript } : {}),
    ...(afterScript !== undefined ? { afterScript } : {}),
    ...(delay !== undefined ? { delay } : {}),
  };
}

/**
 * Convert `script` into shell operations.
 */
function convertScript(job: Record<string, unknown>, operations: OperationDefinition[]): void {
  if (typeof job.script === "string") {
    operations.push({ kind: "shell", command: job.script });
  } else if (Array.isArray(job.script)) {
    for (const line of job.script) {
      if (typeof line === "string") {
        operations.push({ kind: "shell", command: line });
      }
    }
  }
}

/**
 * Convert `needs` into dependencies.
 */
function convertNeeds(job: Record<string, unknown>, dependencies: Dependency[]): void {
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
}

/**
 * Convert `trigger` into downstream/child pipeline diagnostics.
 */
function convertTrigger(
  key: string,
  job: Record<string, unknown>,
  operations: OperationDefinition[],
  diagnostics: ImportDiagnostic[],
): void {
  if (!job.trigger || typeof job.trigger !== "object") return;
  const trigger = job.trigger as Record<string, unknown>;
  if (typeof trigger.project === "string") {
    operations.push({
      kind: "diagnostic",
      message: `imported downstream trigger to project: ${trigger.project}`,
      severity: "info",
    });
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

/**
 * Convert `release` into a release operation.
 */
function convertRelease(job: Record<string, unknown>, operations: OperationDefinition[]): void {
  if (!job.release || typeof job.release !== "object") return;
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

/**
 * Convert `pages` into a deployPages operation.
 */
function convertPages(job: Record<string, unknown>, operations: OperationDefinition[]): void {
  if (!job.pages || typeof job.pages !== "object") return;
  const pages = job.pages as Record<string, unknown>;
  operations.push({
    kind: "deployPages",
    path: typeof pages.publish === "string" ? pages.publish : "public/",
    ...(typeof pages.path_prefix === "string" ? { prefix: pages.path_prefix } : {}),
  });
}

/**
 * Record diagnostics for constructs that cannot be mapped to the IR.
 */
function recordUnmappableConstructs(
  key: string,
  job: Record<string, unknown>,
  diagnostics: ImportDiagnostic[],
): void {
  if (job.cache) {
    diagnostics.push({ severity: "info", message: `job '${key}' has cache — not imported`, path: key });
  }
  if (job.services) {
    diagnostics.push({ severity: "info", message: `job '${key}' has services — not imported`, path: key });
  }
  if (job.matrix) {
    diagnostics.push({ severity: "warn", message: `job '${key}' has matrix — not imported`, path: key });
  }
}

/**
 * Valid `when` values for job-level rules.
 */
const JOB_RULE_WHEN_VALUES = new Set(["on_success", "on_failure", "always", "never", "manual"]);

/**
 * Convert a single raw rule object into a StepDefinition rule entry.
 */
function convertJobRuleEntry(r: Record<string, unknown>): Rule {
  const ruleEntry: { if?: string; changes?: readonly string[]; exists?: readonly string[]; when?: Rule["when"]; variables?: Record<string, string> } = {};
  if (typeof r.if === "string") ruleEntry.if = r.if;
  if (Array.isArray(r.changes)) ruleEntry.changes = r.changes as readonly string[];
  if (Array.isArray(r.exists)) ruleEntry.exists = r.exists as readonly string[];
  if (typeof r.when === "string" && JOB_RULE_WHEN_VALUES.has(r.when)) {
    ruleEntry.when = r.when as Rule["when"];
  }
  const variables = extractRuleVariables(r);
  if (variables) ruleEntry.variables = variables;
  return ruleEntry as Rule;
}

/**
 * Convert job-level `rules` into StepDefinition rules.
 */
function convertJobRules(job: Record<string, unknown>): readonly Rule[] {
  if (!Array.isArray(job.rules)) return [];
  const rules: Rule[] = [];
  for (const rule of job.rules) {
    if (!rule || typeof rule !== "object") continue;
    rules.push(convertJobRuleEntry(rule as Record<string, unknown>));
  }
  return rules;
}

/**
 * Convert a script array field (before_script/after_script) from a job.
 */
function convertScriptArray(job: Record<string, unknown>, field: string): readonly string[] | undefined {
  const value = job[field];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    const lines = value.filter((v): v is string => typeof v === "string");
    if (lines.length > 0) return lines;
  }
  return undefined;
}

/**
 * Convert `when: delayed` + `start_in` to a delay string.
 */
function convertDelay(job: Record<string, unknown>): string | undefined {
  if (job.when === "delayed" && typeof job.start_in === "string") {
    return job.start_in;
  }
  return undefined;
}

/**
 * Convert artifact `paths` into exportArtifact operations.
 */
function convertArtifactPaths(artifacts: Record<string, unknown>, operations: OperationDefinition[]): void {
  const paths = artifacts.paths;
  if (!Array.isArray(paths)) return;
  for (const path of paths) {
    if (typeof path === "string") {
      operations.push({ kind: "exportArtifact", name: path.split("/").pop() ?? path, path });
    }
  }
}

/**
 * Convert artifact `reports` into report operations.
 * Reports are noted but not fully mapped — they require spec types.
 */
function convertArtifactReports(artifacts: Record<string, unknown>, operations: OperationDefinition[]): void {
  if (!artifacts.reports || typeof artifacts.reports !== "object") return;
  const reports = artifacts.reports as Record<string, unknown>;
  for (const [type, value] of Object.entries(reports)) {
    if (typeof value === "string") {
      operations.push({ kind: "report", spec: { type, path: value } });
    }
  }
}

/**
 * Convert `artifacts` into exportArtifact operations.
 */
function convertArtifacts(job: Record<string, unknown>, operations: OperationDefinition[]): void {
  if (!job.artifacts || typeof job.artifacts !== "object") return;
  const artifacts = job.artifacts as Record<string, unknown>;
  convertArtifactPaths(artifacts, operations);
  convertArtifactReports(artifacts, operations);
}
