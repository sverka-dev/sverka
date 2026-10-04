import { mkdir } from "node:fs/promises";
import { main } from "sverka";

/**
 * Run `sverka init` with create-* argument translation.
 *
 * `npm create sverka` / `bun create sverka` / `bunx create-sverka` resolve
 * this package by the create-* convention. A leading positional argument
 * is the target directory (e.g. `bun create sverka my-app`); it is created
 * and mapped to `sverka init --root <dir>`. Everything else forwards
 * verbatim.
 */
export async function createSverka(argv: string[]): Promise<number> {
  const userArgs = [...argv];
  const cliArgs = ["init"];
  const positional = userArgs[0];
  if (positional !== undefined && !positional.startsWith("-")) {
    userArgs.shift();
    await mkdir(positional, { recursive: true });
    cliArgs.push("--root", positional);
  }
  return main([...cliArgs, ...userArgs]);
}
