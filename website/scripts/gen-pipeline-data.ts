/**
 * Generate pipeline run data for the /pipeline/ page.
 *
 * - "self": `sverka run` on this repo (source CLI — needs root deps built)
 * - each project under examples/ via the published `bunx @sverka/cli`
 *
 * A failed pipeline is data, not an error — the script only throws when
 * nothing could be produced. Outputs (gitignored, rebuilt every deploy):
 *   - src/generated/pipelines.json — status data for the /pipeline/ page
 *   - public/pipeline-reports/{,examples/}<id>.html — full standalone
 *     run reports (DAG + SARIF findings) linked from each section
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const websiteDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(websiteDir);
const outFile = join(websiteDir, "src", "generated", "pipelines.json");
const reportDir = join(websiteDir, "public", "pipeline-reports");

interface RunCapture {
  id: string;
  exitCode: number;
  /** Parsed `sverka run --format json` payload, if emitted. */
  run?: unknown;
  /** Tail of raw output for the failure path. */
  outputTail: string;
  /** Report path relative to public/pipeline-reports/, if produced. */
  reportFile?: string;
}

/**
 * Run `sverka run --format html --output <reportDir>/<scope>/<id>.html`
 * so the page can deep-link to the full standalone report (DAG +
 * findings). `scope` namespaces reports ("" = self, "examples" = demos)
 * so an example named `sverka` can't clobber the self report. argv form —
 * no shell — and any previous file is removed first, so a failed run
 * can't resurrect a stale report. Returns the path relative to
 * reportDir on success.
 */
function report(
  scope: string,
  id: string,
  cwd: string,
  cliArgv: string[],
): string | undefined {
  const rel = join(scope, `${id}.html`);
  const out = join(reportDir, rel);
  rmSync(out, { force: true });
  mkdirSync(dirname(out), { recursive: true });
  spawnSync(
    cliArgv[0]!,
    [...cliArgv.slice(1), "run", "--format", "html", "--output", out],
    {
      cwd,
      encoding: "utf-8",
      env: { ...process.env, CI: "true" },
      timeout: 600_000,
    },
  );
  return existsSync(out) ? rel : undefined;
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

function esc(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
}

function badge(exitCode: number): string {
  return exitCode === 0
    ? '<span class="ok">passed</span>'
    : '<span class="fail">failed</span>';
}

/**
 * Minimal index page so /pipeline-reports/ itself resolves on GitHub
 * Pages — lists every report actually produced, with run status.
 */
function renderIndex(
  self: RunCapture,
  examples: RunCapture[],
  commit: string,
): string {
  const rows = [
    self.reportFile &&
      `<li><a href="${esc(self.reportFile)}">${esc(self.id)}</a> ${badge(
        self.exitCode,
      )} <span class="src">self-run on this repo</span></li>`,
    ...examples.map(
      (c) =>
        c.reportFile &&
        `<li><a href="${esc(c.reportFile)}">${esc(c.id)}</a> ${badge(
          c.exitCode,
        )} <span class="src">examples/${esc(c.id)}</span></li>`,
    ),
  ]
    .filter(Boolean)
    .join("\n      ");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sverka — Pipeline reports</title>
<style>
body { margin: 0; background: #0d1117; color: #c9d1d9; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
main { max-width: 44rem; margin: 3rem auto; padding: 0 1rem; }
h1 { font-size: 1.4rem; color: #e6edf3; }
ul { list-style: none; padding: 0; margin: 1.5rem 0; }
li { padding: .7rem 1rem; border: 1px solid #21262d; border-radius: 8px; margin: .5rem 0; }
a { color: #58a6ff; text-decoration: none; font-family: ui-monospace, SFMono-Regular, monospace; }
a:hover { text-decoration: underline; }
.ok { color: #3fb950; } .fail { color: #f85149; }
.src { color: #8b949e; font-size: .85rem; }
.meta { color: #8b949e; font-size: .8rem; }
a.back { font-family: inherit; font-size: .85rem; }
</style>
</head>
<body>
<main>
  <a class="back" href="../">← sverka</a>
  <h1>Pipeline reports</h1>
  <p class="meta">Generated ${esc(new Date().toISOString().slice(0, 10))} · commit ${esc(commit || "unknown")}</p>
  <ul>
      ${rows || "<li>No reports produced</li>"}
  </ul>
</main>
</body>
</html>
`;
}

await mkdir(reportDir, { recursive: true });

const self = capture(
  "sverka",
  repoRoot,
  "bun packages/cli/src/bin.ts run --format json",
);
self.reportFile = report("", "sverka", repoRoot, [
  "bun",
  "packages/cli/src/bin.ts",
]);

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
  const c = capture(entry.name, dir, "bunx sverka run --format json");
  c.reportFile = report("examples", entry.name, dir, ["bunx", "sverka"]);
  examples.push(c);
}

const commit = (
  spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf-8",
  }).stdout ?? ""
).trim();

// A page with zero parsed runs is meaningless — fail the build loudly
// instead of rendering a page full of "no output captured".
if (![self, ...examples].some((c) => c.run)) {
  throw new Error(
    "no sverka run produced JSON output — check CLI availability",
  );
}

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
await writeFile(join(reportDir, "index.html"), renderIndex(self, examples, commit));
console.log(
  `pipeline data → ${outFile} (self exit=${self.exitCode}, examples=${examples.length})`,
);
