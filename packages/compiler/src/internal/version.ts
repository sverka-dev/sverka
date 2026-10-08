import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve the compiler package version from its own package.json.
 * Used to pin `sverka@<version>` invocations emitted into generated CI
 * YAML so compiled output is reproducible. Walks up from this module so
 * it works from src/ (dev) and dist/ alike.
 */
export function compilerVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (true) {
    try {
      const pkg = JSON.parse(
        readFileSync(join(dir, "package.json"), "utf8"),
      ) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === "@sverka/compiler" && pkg.version) {
        return pkg.version;
      }
    } catch {
      // no readable package.json at this level — keep walking
    }
    const parent = dirname(dir);
    if (parent === dir) return "0.0.0";
    dir = parent;
  }
}
