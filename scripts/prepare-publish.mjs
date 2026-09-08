/**
 * Replace `workspace:*` dependencies with actual version ranges before npm publish.
 *
 * In a bun monorepo, package.json files use `workspace:*` for local deps.
 * npm registry rejects `workspace:*` — it must be replaced with a real version
 * range before publishing. This script rewrites all package.json files in-place,
 * replacing `workspace:*` with `^<version>` where <version> is the local package's
 * current version.
 *
 * Run `git checkout -- packages` after publishing to restore
 * the workspace protocol for local development.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = import.meta.dirname.replace("/scripts", "");
const packagesDir = join(root, "packages");

// Build a map of package name → version from all package.json files
const versions = new Map();
for (const dir of readdirSync(packagesDir)) {
  const pkgPath = join(packagesDir, dir, "package.json");
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (pkg.name && pkg.version) {
      versions.set(pkg.name, pkg.version);
    }
  } catch {
    // not a package directory
  }
}

let replaced = 0;
for (const dir of readdirSync(packagesDir)) {
  const pkgPath = join(packagesDir, dir, "package.json");
  let raw;
  try {
    raw = readFileSync(pkgPath, "utf8");
  } catch {
    continue;
  }
  const pkg = JSON.parse(raw);
  let changed = false;
  for (const depField of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    const deps = pkg[depField];
    if (!deps) continue;
    for (const [name, spec] of Object.entries(deps)) {
      if (spec === "workspace:*") {
        const ver = versions.get(name);
        if (ver) {
          deps[name] = `^${ver}`;
          changed = true;
          replaced++;
        }
      }
    }
  }
  if (changed) {
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  }
}

console.log(`prepare-publish: replaced ${replaced} workspace:* references with version ranges`);
