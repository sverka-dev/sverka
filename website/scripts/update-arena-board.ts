/**
 * Render the arena leaderboard for /benchmark/board.html.
 *
 * The leaderboard is a static artifact (GitHub Pages, no server): a CI
 * job or maintainer runs this after arena publishes land in the results
 * registry, and the generated HTML is committed — the same committed-
 * snapshot discipline as arena-results.json (docs:arena).
 *
 *   bun run docs:board                        # fixture registry fallback
 *   bun run docs:board -- --registry <ref>    # real registry
 *   ARENA_REGISTRY=<ref> bun run docs:board
 *
 * Registry refs are the sverka-arena ones: <dir> | file://<dir> |
 * <git-url> | git::<url> | s3://<bucket>/<prefix>. When neither flag
 * nor env gives a registry, the committed fixture registry under
 * website/fixtures/arena-registry/ is used so the page never ships empty.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile, rename } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Source imports — website/ is not an npm workspace member; bun runs
// the arena sources directly (same convention as update-arena-results).
import { openRegistry } from "../../packages/arena/src/registry.js";
import { buildBoard, renderBoardHtml } from "../../packages/arena/src/board.js";

const websiteDir = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtureRegistry = join(websiteDir, "fixtures", "arena-registry");
const defaultOut = join(websiteDir, "public", "benchmark", "board.html");

/**
 * Render the leaderboard from a registry into `outFile` (atomic write).
 * Returns the number of cohorts rendered.
 */
export async function generateBoard(
  registryRef: string,
  outFile: string,
): Promise<{ cohorts: number; runs: number }> {
  const registry = openRegistry(registryRef);
  const results = await registry.list();
  const cohorts = buildBoard(results);
  const html = renderBoardHtml(cohorts, {
    title: "Sverka Arena — Leaderboard",
    generatedAt: new Date().toISOString(),
  });
  await mkdir(dirname(outFile), { recursive: true });
  const tmp = `${outFile}.tmp`;
  await writeFile(tmp, html, "utf8");
  await rename(tmp, outFile);
  return { cohorts: cohorts.length, runs: results.length };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  let registry: string | undefined;
  let out = defaultOut;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--registry" || flag === "--out") {
      const value = argv[++i];
      if (value === undefined) {
        console.error(`'${flag}' requires a value`);
        process.exit(2);
      }
      if (flag === "--registry") registry = value;
      else out = resolve(value);
    } else {
      console.error(`unknown option '${flag}'`);
      process.exit(2);
    }
  }
  registry ??= process.env.ARENA_REGISTRY;
  if (registry === undefined) {
    if (!existsSync(fixtureRegistry)) {
      console.error(
        "no registry — pass --registry <ref>, set ARENA_REGISTRY, or add " +
          "results under website/fixtures/arena-registry/",
      );
      process.exit(2);
    }
    registry = fixtureRegistry;
  }
  const { cohorts, runs } = await generateBoard(registry, out);
  console.log(
    `leaderboard rendered: ${cohorts} cohort(s) from ${runs} run(s) → ${out}`,
  );
}
