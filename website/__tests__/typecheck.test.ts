import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const websiteDir = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The website's typecheck has to stand on its own: `bun run check` in
 * website/ is the documented way to typecheck the site, and it must work
 * from a clean checkout — the route tree is generated first, and nothing
 * outside website/ (a sibling package's sources, the workspace's
 * node_modules, its build output) is needed to typecheck it.
 *
 * The second assertion is the one that keeps it that way: tsc reports
 * every file its program reads, so a file from outside the website shows
 * up here — the website would then typecheck against code it does not
 * own (the DOM lib's ReadableStream and node:stream's are different
 * types, which is exactly how a sibling package's sources break it).
 */
describe("website typecheck", () => {
  it("passes on its own", () => {
    const check = spawnSync("bun", ["run", "check"], {
      cwd: websiteDir,
      encoding: "utf8",
      timeout: 300_000,
    });
    const output = `${check.stdout ?? ""}${check.stderr ?? ""}`;
    expect(check.status, output).toBe(0);
  }, 300_000);

  it("reads no file outside the website", () => {
    const listed = spawnSync("bunx", ["tsc", "--noEmit", "--listFiles"], {
      cwd: websiteDir,
      encoding: "utf8",
      timeout: 300_000,
    });
    const output = `${listed.stdout ?? ""}${listed.stderr ?? ""}`;
    expect(listed.status, output).toBe(0);

    const outside = output
      .split("\n")
      .filter((line) => line.startsWith("/"))
      .filter((line) => !line.startsWith(`${websiteDir}/`));
    expect(
      outside,
      `typecheck reads files outside the website:\n${outside.join("\n")}`,
    ).toEqual([]);
  }, 300_000);
});
