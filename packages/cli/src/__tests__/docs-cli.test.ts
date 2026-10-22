import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildParser } from "../main.js";

const DOC_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../engdocs/user/running/cli.md",
);

const AUTO_FLAGS = new Set(["help", "version"]);

/** Renders yargs help output for the given argv. */
async function helpFor(args: string[]): Promise<string> {
  const parser = buildParser().exitProcess(false);
  let out = "";
  await parser.parseAsync(args, (_err, _argv, output) => {
    if (output) out = output;
  });
  return out;
}

/** Extracts `--flag` names from help output. */
function flagsOf(help: string): Set<string> {
  const flags = new Set<string>();
  for (const m of help.matchAll(/^\s+--([a-z0-9-]+)/gm)) flags.add(m[1]);
  for (const auto of AUTO_FLAGS) flags.delete(auto);
  return flags;
}

/** Registered command names from the top-level help "Commands:" block. */
async function commandNames(): Promise<string[]> {
  const help = await helpFor(["--help"]);
  const names: string[] = [];
  for (const line of help.split("\n")) {
    const m = line.match(/^\s*sverka ([a-z-]+)/);
    if (m) names.push(m[1]);
  }
  return names;
}

/** Splits cli.md into sections keyed by `### \`sverka <cmd>` headings. */
function docSections(doc: string): Map<string, string> {
  const sections = new Map<string, string>();
  const re = /^### `sverka ([a-z-]+)[^`]*`$/gm;
  const heads = [...doc.matchAll(re)];
  heads.forEach((h, i) => {
    const start = h.index! + h[0].length;
    const end = i + 1 < heads.length ? heads[i + 1].index! : doc.indexOf("\n## Global flags");
    sections.set(h[1], doc.slice(start, end));
  });
  return sections;
}

describe("cli.md stays in sync with registered commands", () => {
  const doc = readFileSync(DOC_PATH, "utf8");

  it("documents every registered command", async () => {
    const documented = new Set(docSections(doc).keys());
    expect([...documented].sort()).toEqual((await commandNames()).sort());
  });

  it("documents every flag of every command", async () => {
    const sections = docSections(doc);
    const globalSection = doc.slice(doc.indexOf("## Global flags"));
    const missing: string[] = [];
    for (const cmd of await commandNames()) {
      const flags = flagsOf(await helpFor([cmd, "--help"]));
      const section = sections.get(cmd) ?? "";
      for (const flag of flags) {
        if (!section.includes(`--${flag}`) && !globalSection.includes(`--${flag}`)) {
          missing.push(`${cmd} --${flag}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("documents every global flag", async () => {
    const section = doc.slice(doc.indexOf("## Global flags"));
    const missing = [...flagsOf(await helpFor(["--help"]))].filter(
      (f) => !section.includes(`--${f}`),
    );
    expect(missing).toEqual([]);
  });
});
