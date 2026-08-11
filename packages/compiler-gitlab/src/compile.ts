import { stringify } from "yaml";
import type { Plan } from "@sverka/ir";
import type { GitlabCompilerConfig, GitlabRule } from "./types.js";

const DEFAULT_RULES: readonly GitlabRule[] = [
  { if: '$CI_PIPELINE_SOURCE == "push"' },
  { if: '$CI_PIPELINE_SOURCE == "merge_request_event"' },
];

/**
 * Compile a Plan to a GitLab CI YAML string.
 *
 * Pure and synchronous: no I/O, no side effects. The same plan + config
 * always produces the same YAML.
 *
 * Thin wrapper (ADR-004): a single job installs Sverka and runs `sverka execute`.
 * The plan's contents do not affect the output — execution is delegated to
 * Sverka at runtime. The chosen `image` must provide the Bun runtime.
 */
export function compileGitlabCi(
  plan: Plan,
  config?: GitlabCompilerConfig,
): string {
  void plan; // accepted for API consistency; thin wrapper ignores contents
  const image = config?.image ?? "oven/bun:latest";
  const sverkaVersion = config?.sverkaVersion ?? "latest";
  const rules = config?.rules ?? DEFAULT_RULES;

  const job: Record<string, unknown> = {
    stage: "verify",
    image,
    rules: rules
      .filter((r) => r.if !== undefined || r.when !== undefined)
      .map((r) => {
        const entry: Record<string, unknown> = {};
        if (r.if !== undefined) entry.if = r.if;
        if (r.when !== undefined) entry.when = r.when;
        return entry;
      }),
    before_script: [`bun install -g sverka@${sverkaVersion}`],
    script: ["sverka execute"],
    artifacts: { when: "always", paths: [".sverka/output/"] },
  };

  const pipeline = {
    stages: ["verify"],
    sverka: job,
  };

  return stringify(pipeline);
}
