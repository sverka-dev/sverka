/**
 * Generate pipeline run data for the /pipeline/ page.
 *
 * - "self": `sverka run` on this repo (source CLI — needs root deps built)
 * - each project under examples/ via the published `bunx @sverka/cli`
 *
 * A failed pipeline is data, not an error — the script only throws when
 * nothing could be produced. Output: src/generated/pipelines.json
 * (gitignored — regenerated on every site build).
 */
import { spawnSync } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const websiteDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(websiteDir);
const outFile = join(websiteDir, "src", "generated", "pipelines.json");

interface RunCapture {
  id: string;
  exitCode: number;
  /** Parsed `sverka run --format json` payload, if emitted. */
  run?: unknown;
  /** Tail of raw output for the failure path. */
  outputTail: string;
}

function capture(id: string, cwd: string, command: string): RunCapture {
  const res = spawnSync("bash", ["-c", command], {
    cwd,
    encoding: "utf-8",
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, CI: "true" },
    timeout: 600_000,
  });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  let run: unknown;
  try {
    run = JSON.parse(out.trim());
  } catch {
    // not a pure-JSON stdout — try the last line that looks like JSON
    const last = out
      .trim()
      .split("\n")
      .filter((l) => l.trimStart().startsWith("{"))
      .pop();
    if (last) {
      try {
        run = JSON.parse(last);
      } catch {
        run = undefined;
      }
    }
  }
  return { id, exitCode: res.status ?? 1, outputTail: out.slice(-4000), run };
}

const self = capture(
  "sverka",
  repoRoot,
  "bun packages/cli/src/bin.ts run --format json",
);

let entries: Dirent[] = [];
try {
  entries = await readdir(join(repoRoot, "examples"), {
    withFileTypes: true,
  });
} catch {
  // No examples dir — the page renders the self pipeline alone.
}
const examples: RunCapture[] = [];
for (const entry of entries.filter((e) => e.isDirectory())) {
  const dir = join(repoRoot, "examples", entry.name);
  capture(`${entry.name}:install`, dir, "bun install --silent");
  examples.push(capture(entry.name, dir, "bunx sverka run --format json"));
}

const commit = (
  spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf-8",
  }).stdout ?? ""
).trim();

await mkdir(dirname(outFile), { recursive: true });
await writeFile(
  outFile,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      commit,
      self,
      examples,
    },
    null,
    2,
  ),
);
console.log(
  `pipeline data → ${outFile} (self exit=${self.exitCode}, examples=${examples.length})`,
);
