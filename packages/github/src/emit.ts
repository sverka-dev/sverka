// Emit: GithubTargetGraph → YAML artifacts.
// Spec 08 — §19.

import { stringify } from "yaml";
import type {
  GithubTargetGraph,
  GithubJob,
  GithubStep,
  GeneratedArtifact,
} from "./types.js";

/**
 * Emit a GithubTargetGraph as YAML artifacts.
 * Produces one .github/workflows/<name>.yml file.
 */
export function emitGithub(targetGraph: GithubTargetGraph): readonly GeneratedArtifact[] {
  const yaml = stringifyTargetGraph(targetGraph);
  return [
    {
      path: `.github/workflows/${targetGraph.name}.yml`,
      content: yaml,
    },
  ];
}

/**
 * Convert a GithubTargetGraph to a YAML string.
 */
function stringifyTargetGraph(graph: GithubTargetGraph): string {
  const doc: Record<string, unknown> = {
    name: graph.name,
    ...(graph.runName !== undefined ? { "run-name": graph.runName } : {}),
    on: graph.on,
  };

  if (Object.keys(graph.env).length > 0) {
    doc.env = graph.env;
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
    "runs-on": job.runsOn,
  };

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

  if (job.outputs && Object.keys(job.outputs).length > 0) {
    result.outputs = job.outputs;
  }

  if (job.if) {
    result.if = job.if;
  }

  result.steps = job.steps.map((step, i) => stepToYaml(step, i));

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
