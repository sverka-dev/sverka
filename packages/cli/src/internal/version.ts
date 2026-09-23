import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve the @sverka/cli version from its own package.json.
 * Walks up from this module so it works from src/ (dev) and bundled
 * dist/ alike, and never picks up the consumer's cwd package.json
 * (which is what yargs' default --version resolution does).
 */
export function cliVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (true) {
    try {
      const pkg = JSON.parse(
        readFileSync(join(dir, "package.json"), "utf8"),
      ) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === "@sverka/cli" && pkg.version) return pkg.version;
    } catch {
      // no readable package.json at this level — keep walking
    }
    const parent = dirname(dir);
    if (parent === dir) return "0.0.0";
    dir = parent;
  }
}
