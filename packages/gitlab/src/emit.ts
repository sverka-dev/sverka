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
  "spec",
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

  if (graph.autoCancel) {
    doc.workflow = {
      auto_cancel: { on_new_commit: "interruptible" },
    };
  }

  if (Object.keys(graph.variables).length > 0) {
    doc.variables = graph.variables;
  }

  if (graph.default) {
    const def: Record<string, unknown> = {};
    if (graph.default.beforeScript !== undefined) def.before_script = [...graph.default.beforeScript];
    if (graph.default.afterScript !== undefined) def.after_script = [...graph.default.afterScript];
    if (graph.default.timeout !== undefined) def.timeout = graph.default.timeout;
    if (graph.default.retry !== undefined) {
      const retry: Record<string, unknown> = { max: graph.default.retry.max };
      if (graph.default.retry.exitCodes !== undefined) {
        retry.exit_codes = [...graph.default.retry.exitCodes];
      }
      def.retry = retry;
    }
    if (graph.default.interruptible !== undefined) def.interruptible = graph.default.interruptible;
    doc.default = def;
  }

  if (graph.specInputs && Object.keys(graph.specInputs).length > 0) {
    doc.spec = { inputs: graph.specInputs };
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

  assignOptionalList(result, "before_script", job.beforeScript);
  assignOptionalList(result, "after_script", job.afterScript);

  if (job.artifacts) {
    const artifacts: Record<string, unknown> = {};
    if (job.artifacts.paths !== undefined) artifacts.paths = [...job.artifacts.paths];
    if (job.artifacts.reports !== undefined) artifacts.reports = job.artifacts.reports;
    if (job.artifacts.expireIn !== undefined) artifacts.expire_in = job.artifacts.expireIn;
    if (job.artifacts.access !== undefined) artifacts.access = job.artifacts.access;
    result.artifacts = artifacts;
  }

  if (job.variables) {
    result.variables = job.variables;
  }

  if (job.rules && job.rules.length > 0) {
    result.rules = job.rules.map((rule) => {
      const yamlRule: Record<string, unknown> = {};
      if (rule.if !== undefined) yamlRule.if = rule.if;
      if (rule.when !== undefined) yamlRule.when = rule.when;
      if (rule.changes !== undefined) yamlRule.changes = [...rule.changes];
      if (rule.exists !== undefined) yamlRule.exists = [...rule.exists];
      if (rule.variables !== undefined) yamlRule.variables = rule.variables;
      return yamlRule;
    });
  }

  if (job.timeout) {
    result.timeout = job.timeout;
  }

  assignAllowFailure(result, job.allowFailure);
  assignRetry(result, job.retry);
  if (job.parallel?.matrix) {
    // GitLab parallel:matrix requires each variable value to be an array.
    result.parallel = {
      matrix: job.parallel.matrix.map((row: Record<string, unknown>) => {
        const wrapped: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row)) {
          wrapped[k] = Array.isArray(v) ? v : [v];
        }
        return wrapped;
      }),
    };
  } else {
    assignOptional(result, "parallel", job.parallel);
  }

  if (job.interruptible !== undefined) {
    result.interruptible = job.interruptible;
  }

  if (job.tags && job.tags.length > 0) {
    result.tags = [...job.tags];
  }

  if (job.idTokens && Object.keys(job.idTokens).length > 0) {
    const idTokens: Record<string, { aud: string }> = {};
    for (const [name, spec] of Object.entries(job.idTokens)) {
      idTokens[name] = { aud: spec.aud };
    }
    result.id_tokens = idTokens;
  }

  if (job.services && job.services.length > 0) {
    result.services = job.services.map((svc) => {
      const s: Record<string, unknown> = { name: svc.name };
      if (svc.alias !== undefined) s.alias = svc.alias;
      if (svc.entrypoint !== undefined) s.entrypoint = [...svc.entrypoint];
      if (svc.command !== undefined) s.command = [...svc.command];
      if (svc.variables !== undefined) s.variables = svc.variables;
      return s;
    });
  }

  if (job.environment) {
    const env: Record<string, unknown> = { name: job.environment.name };
    if (job.environment.url !== undefined) env.url = job.environment.url;
    if (job.environment.action !== undefined) env.action = job.environment.action;
    if (job.environment.deploymentTier !== undefined) env.deployment_tier = job.environment.deploymentTier;
    if (job.environment.onStop !== undefined) env.on_stop = job.environment.onStop;
    result.environment = env;
  }

  if (job.cache) {
    const cache: Record<string, unknown> = {
      paths: [...job.cache.paths],
      key: job.cache.key,
    };
    if (job.cache.policy !== undefined) cache.policy = job.cache.policy;
    if (job.cache.fallbackKeys !== undefined) cache.fallback_keys = [...job.cache.fallbackKeys];
    result.cache = cache;
  }

  if (job.resourceGroup !== undefined) {
    result.resource_group = job.resourceGroup;
  }

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
  // GitLab enforces a maximum of 2 retries.
  const retry: Record<string, unknown> = { max: Math.min(value.max, 2) };
  if (value.when && value.when.length > 0) retry.when = [...value.when];
  if (value.exitCodes && value.exitCodes.length > 0) retry.exit_codes = [...value.exitCodes];
  result.retry = retry;
}
