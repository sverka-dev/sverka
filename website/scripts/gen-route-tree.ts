/**
 * Generate src/routeTree.gen.ts without a dev server or full build.
 *
 * `bun run check` (tsc --noEmit) needs the route tree on disk to typecheck,
 * but the file is gitignored and otherwise only produced by `vite dev` /
 * `vite build`. The router-generator plugin inside tanstackStart() writes it
 * during vite's `configResolved` hook — which fires on createServer, so a
 * middlewareMode server (no port bound) regenerates the identical file.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const server = await createServer({
  root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  server: { middlewareMode: true },
  logLevel: "warn",
});
await server.close();
