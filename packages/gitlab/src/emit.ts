// Emit: GitlabTargetGraph → YAML artifacts.
// Spec 09 — §19.

import { stringify } from "yaml";
import { GitlabTargetError } from "./errors.js";
import type {
  GitlabTargetGraph,
  GitlabJob,
  GitlabRule,
  GitlabService,
  GitlabEnvironment,
  GitlabCache,
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
    doc.default = defaultToYaml(graph.default);
  }

  if (graph.specInputs && Object.keys(graph.specInputs).length > 0) {
    doc.spec = { inputs: graph.specInputs };
  }

  // F-32: emit component includes.
  // F-44: emit local includes alongside component includes.
  const allIncludes = collectIncludes(graph);
  if (allIncludes.length > 0) {
    doc.include = allIncludes;
  }

  // F-42: emit workflow rules.
  if (graph.workflowRules && graph.workflowRules.length > 0) {
    doc.workflow = { rules: graph.workflowRules.map(workflowRuleToYaml) };
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
 * Convert a GitlabDefault to a YAML-compatible object.
 */
function defaultToYaml(def: NonNullable<GitlabTargetGraph["default"]>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (def.beforeScript !== undefined) result.before_script = [...def.beforeScript];
  if (def.afterScript !== undefined) result.after_script = [...def.afterScript];
  if (def.timeout !== undefined) result.timeout = def.timeout;
  if (def.retry !== undefined) {
    const retry: Record<string, unknown> = { max: def.retry.max };
    if (def.retry.exitCodes !== undefined) {
      retry.exit_codes = [...def.retry.exitCodes];
    }
    result.retry = retry;
  }
  if (def.interruptible !== undefined) result.interruptible = def.interruptible;
  return result;
}

/**
 * Collect all include entries (component + local) from a GitlabTargetGraph.
 */
function collectIncludes(graph: GitlabTargetGraph): Record<string, unknown>[] {
  const allIncludes: Record<string, unknown>[] = [];
  for (const inc of graph.includes) {
    allIncludes.push({
      component: inc.component,
      ...(Object.keys(inc.inputs).length > 0 ? { inputs: inc.inputs } : {}),
    });
  }
  if (graph.localIncludes) {
    for (const inc of graph.localIncludes) {
      allIncludes.push({
        local: inc.local,
        ...(inc.inputs && Object.keys(inc.inputs).length > 0 ? { inputs: inc.inputs } : {}),
      });
    }
  }
  return allIncludes;
}

/**
 * Convert a workflow rule to a YAML-compatible object.
 */
function workflowRuleToYaml(rule: NonNullable<GitlabTargetGraph["workflowRules"]>[number]): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  if (rule.if) r.if = rule.if;
  if (rule.changes) r.changes = rule.changes;
  if (rule.exists) r.exists = rule.exists;
  if (rule.variables) r.variables = rule.variables;
  if (rule.when) r.when = rule.when;
  return r;
}

/**
 * Convert a GitlabJob to a YAML-compatible object.
 */
function jobToYaml(job: GitlabJob): Record<string, unknown> {
  const result: Record<string, unknown> = {
    stage: job.stage,
    script: job.script,
  };

  // Simple field copies: [yamlKey, jobKey, condition]
  const simpleFields: Array<[string, keyof GitlabJob, unknown]> = [
    ["image", "image", job.image],
    ["timeout", "timeout", job.timeout],
    ["interruptible", "interruptible", job.interruptible],
    ["resource_group", "resourceGroup", job.resourceGroup],
    ["trigger", "trigger", job.trigger],
    ["release", "release", job.release],
    ["pages", "pages", job.pages],
    ["when", "when", job.when],
    ["start_in", "start_in", job.start_in],
  ];
  for (const [yamlKey, _jobKey, value] of simpleFields) {
    if (value !== undefined && value !== null) {
      result[yamlKey] = value;
    }
  }

  if (job.needs.length > 0) {
    result.needs = [...job.needs];
  }

  assignOptionalList(result, "before_script", job.beforeScript);
  assignOptionalList(result, "after_script", job.afterScript);

  if (job.artifacts) {
    result.artifacts = artifactsToYaml(job.artifacts);
  }

  if (job.variables) {
    result.variables = job.variables;
  }

  if (job.rules && job.rules.length > 0) {
    result.rules = job.rules.map(ruleToYaml);
  }

  if (job.timeout) {
    result.timeout = job.timeout;
  }

  assignAllowFailure(result, job.allowFailure);
  assignRetry(result, job.retry);
  if (job.parallel && job.parallel.matrix) {
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
    result.id_tokens = idTokensToYaml(job.idTokens);
  }

  if (job.services && job.services.length > 0) {
    result.services = job.services.map(serviceToYaml);
  }

  if (job.environment) {
    result.environment = environmentToYaml(job.environment);
  }

  if (job.cache) {
    result.cache = cacheToYaml(job.cache);
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

/**
 * Convert an artifacts spec to a YAML-compatible object.
 */
function artifactsToYaml(artifacts: GitlabJob["artifacts"]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (artifacts!.paths !== undefined) result.paths = [...artifacts!.paths];
  if (artifacts!.reports !== undefined) result.reports = artifacts!.reports;
  if (artifacts!.expireIn !== undefined) result.expire_in = artifacts!.expireIn;
  if (artifacts!.access !== undefined) result.access = artifacts!.access;
  return result;
}

/**
 * Convert a job rule to a YAML-compatible object.
 */
function ruleToYaml(rule: GitlabRule): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  if (rule.if !== undefined) r.if = rule.if;
  if (rule.when !== undefined) r.when = rule.when;
  if (rule.changes !== undefined) r.changes = [...rule.changes];
  if (rule.exists !== undefined) r.exists = [...rule.exists];
  if (rule.variables !== undefined) r.variables = rule.variables;
  return r;
}

/**
 * Convert id tokens to a YAML-compatible object.
 */
function idTokensToYaml(idTokens: NonNullable<GitlabJob["idTokens"]>): Record<string, { aud: string }> {
  const result: Record<string, { aud: string }> = {};
  for (const [name, spec] of Object.entries(idTokens)) {
    result[name] = { aud: spec.aud };
  }
  return result;
}

/**
 * Convert a service to a YAML-compatible object.
 */
function serviceToYaml(svc: GitlabService): Record<string, unknown> {
  const s: Record<string, unknown> = { name: svc.name };
  if (svc.alias !== undefined) s.alias = svc.alias;
  if (svc.entrypoint !== undefined) s.entrypoint = [...svc.entrypoint];
  if (svc.command !== undefined) s.command = [...svc.command];
  if (svc.variables !== undefined) s.variables = svc.variables;
  return s;
}

/**
 * Convert an environment spec to a YAML-compatible object.
 */
function environmentToYaml(env: GitlabEnvironment): Record<string, unknown> {
  const result: Record<string, unknown> = { name: env.name };
  if (env.url !== undefined) result.url = env.url;
  if (env.action !== undefined) result.action = env.action;
  if (env.deploymentTier !== undefined) result.deployment_tier = env.deploymentTier;
  if (env.onStop !== undefined) result.on_stop = env.onStop;
  return result;
}

/**
 * Convert a cache spec to a YAML-compatible object.
 */
function cacheToYaml(cache: GitlabCache): Record<string, unknown> {
  const result: Record<string, unknown> = {
    paths: [...cache.paths],
    key: cache.key,
  };
  if (cache.policy !== undefined) result.policy = cache.policy;
  if (cache.fallbackKeys !== undefined) result.fallback_keys = [...cache.fallbackKeys];
  return result;
}
