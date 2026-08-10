import { stringify } from "yaml";
import type { Plan } from "@sverka/ir";
import type {
  GithubCompilerConfig,
  GithubTriggers,
  GithubPermissions,
} from "./types.js";

/**
 * Convert a camelCase key to kebab-case (e.g. securityEvents → security-events).
 */
function toKebab(key: string): string {
  return key.replace(/([A-Z])/g, (match, char: string, offset: number) =>
    offset === 0 ? char.toLowerCase() : `-${char.toLowerCase()}`,
  );
}

/**
 * Build the `on:` triggers section of the workflow.
 * Defaults to push on main + pull_request (all branches).
 */
function buildTriggers(triggers?: GithubTriggers): Record<string, unknown> {
  if (!triggers) {
    return {
      push: { branches: ["main"] },
      pull_request: null,
    };
  }
  const result: Record<string, unknown> = {};
  if (triggers.push) {
    result.push = { branches: [...triggers.push] };
  }
  if (triggers.pullRequest) {
    result.pull_request =
      triggers.pullRequest.length > 0
        ? { branches: [...triggers.pullRequest] }
        : null;
  }
  if (triggers.workflowDispatch) {
    result.workflow_dispatch = null;
  }
  return result;
}

/**
 * Build the `permissions:` section. Converts camelCase keys to kebab-case
 * for GitHub Actions YAML (e.g. securityEvents → security-events).
 */
function buildPermissions(
  permissions?: GithubPermissions,
): Record<string, string> {
  const source = permissions ?? { contents: "read" as const };
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) {
      result[toKebab(key)] = value;
    }
  }
  return result;
}

/**
 * Collect unique credential envVars from all operations and build the
 * job-level `env:` block mapping each to `${{ secrets.<ENV_VAR> }}`.
 * Returns an empty object if no credentials are declared.
 */
function buildCredentialEnv(plan: Plan): Record<string, string> {
  const envVars = new Set<string>();
  for (const op of plan.operations) {
    for (const cred of op.credentials) {
      envVars.add(cred.envVar);
    }
  }
  const env: Record<string, string> = {};
  for (const envVar of envVars) {
    env[envVar] = `\${{ secrets.${envVar} }}`;
  }
  return env;
}

/**
 * Compile a Plan to a GitHub Actions workflow YAML string.
 *
 * Pure and synchronous: no I/O, no side effects. The same plan + config
 * always produces the same YAML.
 */
export function compileGithubWorkflow(
  plan: Plan,
  config?: GithubCompilerConfig,
): string {
  const name = config?.name ?? "Sverka";
  const runner = config?.runner ?? "ubuntu-latest";
  const sverkaVersion = config?.sverkaVersion ?? "latest";
  const nodeVersion = config?.nodeVersion ?? "24";
  const triggers = buildTriggers(config?.on);
  const permissions = buildPermissions(config?.permissions);
  const env = buildCredentialEnv(plan);

  const job: Record<string, unknown> = {
    "runs-on": runner,
    steps: [
      { uses: "actions/checkout@v4" },
      {
        uses: "actions/setup-node@v4",
        with: { "node-version": nodeVersion },
      },
      { uses: "oven-sh/setup-bun@v2", with: { version: "latest" } },
      { run: `bun install -g sverka@${sverkaVersion}` },
      { run: "sverka execute" },
      {
        uses: "actions/upload-artifact@v4",
        if: "always()",
        with: { name: "sverka-output", path: ".sverka/output/" },
      },
    ],
  };
  if (Object.keys(env).length > 0) {
    job.env = env;
  }

  const workflow = {
    name,
    on: triggers,
    permissions,
    jobs: { sverka: job },
  };

  return stringify(workflow);
}
