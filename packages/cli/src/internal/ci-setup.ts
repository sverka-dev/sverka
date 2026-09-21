import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GithubStep, GithubTargetConfig } from "@sverka/compiler";

/**
 * Detect the toolchain setup a generated GitHub workflow needs on a clean
 * runner: the package-manager action + dependency install, and recursive
 * submodule checkout when the repo has .gitmodules.
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
  const pm = detectPackageManager(root);
  switch (pm) {
    case "bun":
      return [
        { name: "Setup Bun", uses: "oven-sh/setup-bun@v2" },
        { name: "Install dependencies", run: "bun install --frozen-lockfile" },
      ];
    case "pnpm":
      return [
        { name: "Setup pnpm", uses: "pnpm/action-setup@v4" },
        { name: "Setup Node", uses: "actions/setup-node@v4" },
        { name: "Install dependencies", run: "pnpm install --frozen-lockfile" },
      ];
    case "yarn":
      return [
        { name: "Setup Node", uses: "actions/setup-node@v4" },
        { name: "Install dependencies", run: "yarn install" },
      ];
    case "npm":
      return [
        { name: "Setup Node", uses: "actions/setup-node@v4" },
        {
          name: "Install dependencies",
          run: existsSync(join(root, "package-lock.json")) ? "npm ci" : "npm install",
        },
      ];
    default:
      return [];
  }
}

type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

function detectPackageManager(root: string): PackageManager | undefined {
  const declared = packageManagerField(root);
  if (declared) return declared;
  if (existsSync(join(root, "bun.lock")) || existsSync(join(root, "bun.lockb"))) {
    return "bun";
  }
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(root, "yarn.lock"))) return "yarn";
  if (existsSync(join(root, "package-lock.json"))) return "npm";
  if (existsSync(join(root, "package.json"))) return "npm";
  return undefined;
}

function packageManagerField(root: string): PackageManager | undefined {
  try {
    const raw = readFileSync(join(root, "package.json"), "utf8");
    const pm = (JSON.parse(raw) as { packageManager?: unknown }).packageManager;
    if (typeof pm !== "string") return undefined;
    const name = pm.split("@")[0];
    if (name === "bun" || name === "pnpm" || name === "yarn" || name === "npm") {
      return name;
    }
  } catch {
    // no readable package.json — fall through to lockfile detection
  }
  return undefined;
}
