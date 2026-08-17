// Emit: GitlabTargetGraph → YAML artifacts.
// Spec 09 — §19.

import { stringify } from "yaml";
import { GitlabTargetError } from "./errors.js";
import type {
  GitlabTargetGraph,
  GitlabJob,
  GeneratedArtifact,
} from "./types.js";

const RESERVED_TOP_LEVEL_KEYS = new Set([
  "stages",
  "variables",
  "workflow",
  "include",
  "default",
  "image",
  "services",
  "before_script",
  "after_script",
  "cache",
  "pages:deploy",
]);

/**
 * Emit a GitlabTargetGraph as YAML artifacts.
 * Produces one .gitlab-ci.yml file.
 */
export function emitGitlab(targetGraph: GitlabTargetGraph): readonly GeneratedArtifact[] {
  const yaml = stringifyTargetGraph(targetGraph);
  return [
    {
      path: ".gitlab-ci.yml",
      content: yaml,
    },
  ];
}

/**
 * Convert a GitlabTargetGraph to a YAML string.
 */
function stringifyTargetGraph(graph: GitlabTargetGraph): string {
  const doc: Record<string, unknown> = {
    stages: graph.stages,
  };

  if (Object.keys(graph.variables).length > 0) {
    doc.variables = graph.variables;
  }

  for (const job of graph.jobs) {
    if (RESERVED_TOP_LEVEL_KEYS.has(job.id)) {
      throw new GitlabTargetError(
        `job id '${job.id}' conflicts with a reserved top-level GitLab CI key`,
        "EMIT_FAILED",
      );
    }
    doc[job.id] = jobToYaml(job);
  }

  return stringify(doc, { sortMapEntries: false });
}

/**
 * Convert a GitlabJob to a YAML-compatible object.
 */
function jobToYaml(job: GitlabJob): Record<string, unknown> {
  const result: Record<string, unknown> = {
    stage: job.stage,
    script: job.script,
  };

  if (job.image) {
    result.image = job.image;
  }

  if (job.needs.length > 0) {
    result.needs = [...job.needs];
  }

  if (job.artifacts) {
    result.artifacts = job.artifacts;
  }

  if (job.variables) {
    result.variables = job.variables;
  }

  if (job.rules && job.rules.length > 0) {
    result.rules = job.rules;
  }

  if (job.timeout) {
    result.timeout = job.timeout;
  }

  if (job.parallel) {
    result.parallel = job.parallel;
  }

  return result;
}
