/**
 * Generate the TanStack route tree (src/routeTree.gen.ts).
 *
 * The route tree is a build artifact: the router plugin writes it on every
 * dev/build run, so a `vite build` always has it. A bare `tsc --noEmit` has
 * no plugin — on a clean checkout src/router.tsx cannot resolve
 * "./routeTree.gen" and the typecheck fails before it looks at a line of app
 * code. The typecheck script runs this generator first, so the file the
 * typecheck sees is the file the build would produce.
 *
 * The generator is the one the plugin uses (@tanstack/router-generator),
 * configured exactly like the plugin's defaults: routes under src/routes,
 * tree written to src/routeTree.gen.ts.
 */
import { Generator, getConfig } from "@tanstack/router-generator";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const websiteDir = dirname(dirname(fileURLToPath(import.meta.url)));

const generator = new Generator({
  config: getConfig({}, websiteDir),
  root: websiteDir,
});

await generator.run();
