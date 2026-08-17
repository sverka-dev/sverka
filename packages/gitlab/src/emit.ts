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

  assignOptional(result, "image", job.image);
  if (job.needs.length > 0) result.needs = [...job.needs];
  assignOptionalList(result, "before_script", job.beforeScript);
  assignOptionalList(result, "after_script", job.afterScript);
  assignOptional(result, "artifacts", job.artifacts);
  assignOptional(result, "variables", job.variables);
  if (job.rules && job.rules.length > 0) result.rules = job.rules;
  assignOptional(result, "timeout", job.timeout);
  assignAllowFailure(result, job.allowFailure);
  assignRetry(result, job.retry);
  assignOptional(result, "parallel", job.parallel);

  return result;
}

function assignOptional(
  result: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (value !== undefined) result[key] = value;
}

function assignOptionalList(
  result: Record<string, unknown>,
  key: string,
  value: readonly string[] | undefined,
): void {
  if (value && value.length > 0) result[key] = [...value];
}

function assignAllowFailure(
  result: Record<string, unknown>,
  value: GitlabJob["allowFailure"],
): void {
  if (value === undefined) return;
  if (typeof value === "boolean") {
    result.allow_failure = value;
  } else {
    result.allow_failure = { exit_codes: [...value.exitCodes] };
  }
}

function assignRetry(
  result: Record<string, unknown>,
  value: GitlabJob["retry"],
): void {
  if (value === undefined) return;
  const retry: Record<string, unknown> = { max: value.max };
  if (value.when && value.when.length > 0) retry.when = [...value.when];
  if (value.exitCodes && value.exitCodes.length > 0) retry.exit_codes = [...value.exitCodes];
  result.retry = retry;
}
