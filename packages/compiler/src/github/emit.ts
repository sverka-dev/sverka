// Emit: GithubTargetGraph → YAML artifacts.
// Spec 08 — §19. F-31: multi-workflow emission. Spec 22 — action pinning.

import { stringify } from "yaml";
import type {
  GithubTargetGraph,
  GithubJob,
  GithubStep,
  GeneratedArtifact,
} from "./types.js";

/** Optional emit-time transforms (spec 22: action SHA pinning). */
export interface EmitOptions {
  /** When set, every emitted `uses:` ref is routed through this function. */
  readonly pinUses?: (ref: string) => string;
}

/**
 * Emit one or more GithubTargetGraphs as YAML artifacts.
 * Produces one .github/workflows/<name>.yml file per target graph.
 */
export function emitGithub(
  targetGraph: GithubTargetGraph | readonly GithubTargetGraph[],
  options?: EmitOptions,
): readonly GeneratedArtifact[] {
  const graphs = Array.isArray(targetGraph) ? targetGraph : [targetGraph];
  return graphs.map((g) => ({
    path: `.github/workflows/${sanitizeWorkflowName(g.name)}.yml`,
    content: stringifyTargetGraph(g, options),
  }));
}

/**
 * Sanitize a graph name for use as a workflow filename.
 * GitHub workflow filenames must be valid path segments; replace
 * characters that could break path resolution.
 */
function sanitizeWorkflowName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-");
}

/**
 * A pinned `uses:` ref: `org/name@<40-hex sha> # <tag>`.
 *
 * The tag is audit information, never part of the ref GitHub resolves.
 */
const PINNED_USES_RE = /^(.+@[0-9a-f]{40}) # (.+)$/;

/**
 * Convert a GithubTargetGraph to a YAML string.
 */
function stringifyTargetGraph(
  graph: GithubTargetGraph,
  options?: EmitOptions,
): string {
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
  // Pin tags, keyed by the ref they belong to — re-attached as real YAML
  // comments once the document is serialized.
  const pinTags = new Map<string, string>();
  for (const job of graph.jobs) {
    jobs[job.id] = jobToYaml(job, options, pinTags);
  }
  doc.jobs = jobs;

  // GitHub Actions does not support YAML anchors — never alias repeated
  // objects (e.g. identical `with:` maps injected into every job).
  let yaml = stringify(doc, {
    sortMapEntries: false,
    aliasDuplicateObjects: false,
  });

  // Pinned refs carry the original tag as a trailing YAML comment
  // (`org/name@<sha> # v4`). The serializer quotes any scalar holding a
  // ` # ` — and folds it once the line passes the width — which would make
  // GitHub resolve a ref that includes the tag. The tag is stripped before
  // serialization; here it goes back as a real comment.
  yaml = yaml.replace(
    /^([ \t]*uses:[ \t]*)("?)([^"'\s]+)\2[ \t]*$/gm,
    (match, prefix: string, quote: string, ref: string) => {
      const tag = pinTags.get(ref);
      return tag === undefined
        ? match
        : `${prefix}${quote}${ref}${quote} # ${tag}`;
    },
  );
  return yaml;
}

/**
 * Resolve a `uses:` ref to the value GitHub must resolve.
 *
 * A pinned ref carries its original tag as a trailing comment
 * (`org/name@<sha> # v4`). The tag is stripped here — so the serializer
 * emits a plain, unfolded scalar — and recorded in `pinTags` for the
 * emitter to re-attach as a YAML comment.
 */
function usesValue(
  ref: string,
  options: EmitOptions | undefined,
  pinTags: Map<string, string>,
): string {
  const value = options?.pinUses ? options.pinUses(ref) : ref;
  const match = PINNED_USES_RE.exec(value);
  if (!match) return value;
  const pinnedRef = match[1]!;
  pinTags.set(pinnedRef, match[2]!);
  return pinnedRef;
}

/**
 * Convert a GithubJob to a YAML-compatible object.
 */
function jobToYaml(
  job: GithubJob,
  options: EmitOptions | undefined,
  pinTags: Map<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    name: job.name,
  };

  // Reusable workflow call job: uses/with/secrets (no runs-on/steps).
  if (job.uses) {
    return reusableJobToYaml(job, result, options, pinTags);
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
    result.strategy = strategyToYaml(job.strategy);
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

  result.steps = job.steps.map((step, i) =>
    stepToYaml(step, i, options, pinTags),
  );

  return result;
}

/**
 * Convert a job strategy spec to a YAML-compatible object.
 */
function strategyToYaml(
  strategy: NonNullable<GithubJob["strategy"]>,
): Record<string, unknown> {
  const strat: Record<string, unknown> = { matrix: strategy.matrix };
  if (strategy.failFast !== undefined) {
    strat["fail-fast"] = strategy.failFast;
  }
  if (strategy.maxParallel !== undefined) {
    strat["max-parallel"] = strategy.maxParallel;
  }
  return strat;
}

/**
 * Convert a reusable workflow call job (uses) to a YAML-compatible object.
 */
function reusableJobToYaml(
  job: GithubJob,
  result: Record<string, unknown>,
  options: EmitOptions | undefined,
  pinTags: Map<string, string>,
): Record<string, unknown> {
  result.uses = usesValue(job.uses!, options, pinTags);
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
function concurrencyToYaml(conc: {
  readonly group: string;
  readonly cancelInProgress?: boolean;
}): Record<string, unknown> {
  const result: Record<string, unknown> = { group: conc.group };
  if (conc.cancelInProgress !== undefined) {
    result["cancel-in-progress"] = conc.cancelInProgress;
  }
  return result;
}

/**
 * Convert a GithubStep to a YAML-compatible object.
 */
function stepToYaml(
  step: GithubStep,
  index: number,
  options: EmitOptions | undefined,
  pinTags: Map<string, string>,
): Record<string, unknown> {
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
    result.uses = usesValue(step.uses, options, pinTags);
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
