import { main } from "sverka";

/**
 * Run `sverka init` with create-* argument translation.
 *
 * `npm create sverka` / `bun create sverka` / `bunx create-sverka` resolve
 * this package by the create-* convention. A leading positional argument
 * is the target directory (e.g. `bun create sverka my-app`) and maps to
 * `sverka init --root <dir>` — init creates the directory itself.
 * Everything else forwards verbatim.
 */
export function createSverka(argv: string[]): Promise<number> {
  const userArgs = [...argv];
  const cliArgs = ["init"];
  const positional = userArgs[0];
  if (positional !== undefined && !positional.startsWith("-")) {
    userArgs.shift();
    cliArgs.push("--root", positional);
  }
  return main([...cliArgs, ...userArgs]);
}
