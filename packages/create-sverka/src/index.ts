import { mkdir, rmdir, stat } from "node:fs/promises";
import { main } from "sverka";

/**
 * Run `sverka init` with create-* argument translation.
 *
 * `npm create sverka` / `bun create sverka` / `bunx create-sverka` resolve
 * this package by the create-* convention. A leading positional argument
 * is the target directory (e.g. `bun create sverka my-app`); it is created
 * up front because `init` reads `<root>/package.json` before it writes the
 * config, and mapped to `sverka init --root <dir>`. Everything else
 * forwards verbatim. If `init` fails and the directory was created by us
 * and is still empty, it is removed again.
 */
export async function createSverka(argv: string[]): Promise<number> {
  const userArgs = [...argv];
  const cliArgs = ["init"];
  const positional = userArgs[0];
  let createdDir: string | undefined;
  if (positional !== undefined && !positional.startsWith("-")) {
    userArgs.shift();
    if ((await stat(positional).catch(() => null)) === null) {
      await mkdir(positional, { recursive: true });
      createdDir = positional;
    }
    cliArgs.push("--root", positional);
  }
  const code = await main([...cliArgs, ...userArgs]);
  if (code !== 0 && createdDir !== undefined) {
    // rmdir (non-recursive) only succeeds while the directory is still
    // empty — a partial scaffold is left in place.
    await rmdir(createdDir).catch(() => {});
  }
  return code;
}
