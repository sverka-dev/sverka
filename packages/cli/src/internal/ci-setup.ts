import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GithubStep, GithubTargetConfig } from "@sverka/compiler";

/**
 * Detect the toolchain setup a generated GitHub workflow needs on a clean
 * runner: the package-manager action + dependency install, and recursive
 * submodule checkout when the repo has .gitmodules.
 *
 * The declared `packageManager` version is honored where the toolchain
 * supports it: `bun-version` for bun, Corepack for pnpm/yarn (both read the
 * `packageManager` field), and an explicit global install for npm.
 *
 * Returns undefined when nothing was detected (non-Node project) — the
 * generated YAML then stays identical to the previous behavior.
 */
export function detectCiSetup(root: string): GithubTargetConfig | undefined {
  const setup = detectPackageManagerSetup(root);
  const checkoutWith = existsSync(join(root, ".gitmodules"))
    ? { submodules: "recursive" }
    : undefined;
  if (setup.length === 0 && checkoutWith === undefined) return undefined;
  return {
    ...(setup.length > 0 ? { setup } : {}),
    ...(checkoutWith ? { checkoutWith } : {}),
  };
}

function detectPackageManagerSetup(root: string): GithubStep[] {
  const { name, version } = detectPackageManager(root);
  switch (name) {
    case "bun":
      return bunSteps(version);
    case "pnpm":
      return pnpmSteps(version);
    case "yarn":
      return yarnSteps(version);
    case "npm":
      return npmSteps(root, version);
    default:
      return [];
  }
}

function bunSteps(version?: string): GithubStep[] {
  return [
    {
      name: "Setup Bun",
      uses: "oven-sh/setup-bun@v2",
      ...(version ? { with: { "bun-version": version } } : {}),
    },
    { name: "Install dependencies", run: "bun install --frozen-lockfile --ignore-scripts" },
  ];
}

function pnpmSteps(version?: string): GithubStep[] {
  // pnpm/action-setup reads the version from the packageManager field;
  // the version input is required when the field is absent.
  return [
    {
      name: "Setup pnpm",
      uses: "pnpm/action-setup@v4",
      ...(version ? {} : { with: { version: "latest" } }),
    },
    { name: "Setup Node", uses: "actions/setup-node@v4" },
    { name: "Install dependencies", run: "pnpm install --frozen-lockfile --ignore-scripts" },
  ];
}

function yarnSteps(version?: string): GithubStep[] {
  // Corepack activates the yarn version declared in packageManager.
  return [
    { name: "Setup Node", uses: "actions/setup-node@v4" },
    ...(version ? [{ name: "Enable Corepack", run: "corepack enable" } as GithubStep] : []),
    { name: "Install dependencies", run: "yarn install" },
  ];
}

function npmSteps(root: string, version?: string): GithubStep[] {
  return [
    { name: "Setup Node", uses: "actions/setup-node@v4" },
    ...(version
      ? [{ name: "Pin npm", run: `npm install -g "npm@${version}"` } as GithubStep]
      : []),
    {
      name: "Install dependencies",
      run: existsSync(join(root, "package-lock.json"))
        ? "npm ci --ignore-scripts"
        : "npm install --ignore-scripts",
    },
  ];
}

interface DetectedPm {
  name: "bun" | "pnpm" | "yarn" | "npm";
  version?: string;
}

function detectPackageManager(root: string): Partial<DetectedPm> {
  const declared = packageManagerField(root);
  if (declared) return declared;
  if (existsSync(join(root, "bun.lock")) || existsSync(join(root, "bun.lockb"))) {
    return { name: "bun" };
  }
  if (existsSync(join(root, "pnpm-lock.yaml"))) return { name: "pnpm" };
  if (existsSync(join(root, "yarn.lock"))) return { name: "yarn" };
  if (existsSync(join(root, "package-lock.json"))) return { name: "npm" };
  if (existsSync(join(root, "package.json"))) return { name: "npm" };
  return {};
}

function packageManagerField(root: string): DetectedPm | undefined {
  try {
    const raw = readFileSync(join(root, "package.json"), "utf8");
    const pm = (JSON.parse(raw) as { packageManager?: unknown }).packageManager;
    if (typeof pm !== "string") return undefined;
    const [name, version] = pm.split("@");
    if (name === "bun" || name === "pnpm" || name === "yarn" || name === "npm") {
      return version !== undefined ? { name, version } : { name };
    }
  } catch {
    // no readable package.json — fall through to lockfile detection
  }
  return undefined;
}
