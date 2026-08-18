// Emit: GithubTargetGraph → YAML artifacts.
// Spec 08 — §19. F-31: multi-workflow emission.

import { stringify } from "yaml";
import type {
  GithubTargetGraph,
  GithubJob,
  GithubStep,
  GeneratedArtifact,
} from "./types.js";

/**
 * Emit one or more GithubTargetGraphs as YAML artifacts.
 * Produces one .github/workflows/<name>.yml file per target graph.
 */
export function emitGithub(
  targetGraph: GithubTargetGraph | readonly GithubTargetGraph[],
): readonly GeneratedArtifact[] {
  const graphs = Array.isArray(targetGraph) ? targetGraph : [targetGraph];
  return graphs.map((g) => ({
    path: `.github/workflows/${g.name}.yml`,
    content: stringifyTargetGraph(g),
  }));
}

/**
 * Convert a GithubTargetGraph to a YAML string.
 */
function stringifyTargetGraph(graph: GithubTargetGraph): string {
  const doc: Record<string, unknown> = {
    name: graph.name,
    on: graph.on,
  };

  if (Object.keys(graph.env).length > 0) {
    doc.env = graph.env;
  }

  if (graph.permissions) {
    doc.permissions = graph.permissions;
  }

  if (graph.defaults) {
    doc.defaults = graph.defaults;
  }

  if (graph.concurrency) {
    doc.concurrency = concurrencyToYaml(graph.concurrency);
  }

  const jobs: Record<string, unknown> = {};
  for (const job of graph.jobs) {
    jobs[job.id] = jobToYaml(job);
  }
  doc.jobs = jobs;

  return stringify(doc, { sortMapEntries: false });
}

/**
 * Convert a GithubJob to a YAML-compatible object.
 */
function jobToYaml(job: GithubJob): Record<string, unknown> {
  const result: Record<string, unknown> = {
    name: job.name,
  };

  // Reusable workflow call job: uses/with/secrets (no runs-on/steps).
  if (job.uses) {
    return reusableJobToYaml(job, result);
  }

  // Normal job.
  result["runs-on"] = job.runsOn;

  if (job.needs.length > 0) {
    result.needs = job.needs.length === 1 ? job.needs[0] : [...job.needs];
  }

  if (job.timeoutMinutes !== undefined) {
    result["timeout-minutes"] = job.timeoutMinutes;
  }

  if (job.container) {
    result.container = job.container;
  }

  if (job.env) {
    result.env = job.env;
  }

  if (job.strategy) {
    const strat: Record<string, unknown> = { matrix: job.strategy.matrix };
    if (job.strategy.failFast !== undefined) {
      strat["fail-fast"] = job.strategy.failFast;
    }
    if (job.strategy.maxParallel !== undefined) {
      strat["max-parallel"] = job.strategy.maxParallel;
    }
    result.strategy = strat;
  }

  if (job.permissions) {
    result.permissions = job.permissions;
  }

  if (job.if) {
    result.if = job.if;
  }

  if (job.services) {
    result.services = job.services;
  }

  if (job.environment) {
    result.environment = job.environment;
  }

  if (job.concurrency) {
    result.concurrency = concurrencyToYaml(job.concurrency);
  }

  result.steps = job.steps.map((step, i) => stepToYaml(step, i));

  return result;
}

/**
 * Convert a reusable workflow call job (uses) to a YAML-compatible object.
 */
function reusableJobToYaml(job: GithubJob, result: Record<string, unknown>): Record<string, unknown> {
  result.uses = job.uses;
  if (job.needs.length > 0) {
    result.needs = job.needs.length === 1 ? job.needs[0] : [...job.needs];
  }
  if (job.with && Object.keys(job.with).length > 0) {
    result.with = job.with;
  }
  if (job.secrets) {
    result.secrets = job.secrets;
  }
  return result;
}

/**
 * Convert a concurrency spec to a YAML-compatible object.
 */
function concurrencyToYaml(conc: { readonly group: string; readonly cancelInProgress?: boolean }): Record<string, unknown> {
  const result: Record<string, unknown> = { group: conc.group };
  if (conc.cancelInProgress !== undefined) {
    result["cancel-in-progress"] = conc.cancelInProgress;
  }
  return result;
}

/**
 * Convert a GithubStep to a YAML-compatible object.
 */
function stepToYaml(step: GithubStep, index: number): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // GitHub steps require a name or uses or run.
  if (step.id) {
    result.id = step.id;
  }
  if (step.name) {
    result.name = step.name;
  } else if (!step.uses && !step.run) {
    result.name = `Step ${index + 1}`;
  }

  if (step.uses) {
    result.uses = step.uses;
  }
  if (step.run) {
    result.run = step.run;
  }
  if (step.with) {
    result.with = step.with;
  }
  if (step.env) {
    result.env = step.env;
  }
  if (step.workingDirectory) {
    result["working-directory"] = step.workingDirectory;
  }
  if (step.shell) {
    result.shell = step.shell;
  }

  if (step.if) {
    result.if = step.if;
  }

  if (step.continueOnError !== undefined) {
    result["continue-on-error"] = step.continueOnError;
  }

  return result;
}
