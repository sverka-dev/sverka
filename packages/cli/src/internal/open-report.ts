// Resolve and open the latest run report — backs `sverka view` with no args.
// Spec 53: `sverka run` tails with `report: <path> (sverka view to open)`.

import process from "node:process";
import { spawnSync } from "node:child_process";
import type { SpawnSyncOptions } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Newest `.sverka/runs/<runId>/report.html` under root, by file mtime.
 *  Returns undefined when no run report exists. */
export function findLatestReportHtml(root: string): string | undefined {
  let names: string[];
  try {
    names = readdirSync(join(root, ".sverka", "runs"));
  } catch {
    return undefined; // no runs dir yet
  }
  let best: { path: string; mtimeMs: number } | undefined;
  for (const name of names) {
    const candidate = join(root, ".sverka", "runs", name, "report.html");
    let stat;
    try {
      stat = statSync(candidate);
    } catch {
      continue; // not a run dir, or report.html missing
    }
    if (stat.isFile() && (best === undefined || stat.mtimeMs > best.mtimeMs)) {
      best = { path: candidate, mtimeMs: stat.mtimeMs };
    }
  }
  return best?.path;
}

/** WSL exposes Windows browsers through wslu, not xdg-open. */
function isWsl(): boolean {
  if (process.platform !== "linux") return false;
  try {
    return readFileSync("/proc/sys/kernel/osrelease", "utf8")
      .toLowerCase()
      .includes("microsoft");
  } catch {
    return false;
  }
}

function openerCandidates(
  path: string,
): readonly (readonly [string, string[], SpawnSyncOptions?])[] {
  if (process.platform === "darwin") return [["open", [path]]];
  if (process.platform === "win32") {
    // `cmd /c` re-parses shell metacharacters (& | ^ < > %) anywhere on the
    // command line, and Node's default arg escaping can't produce quoting
    // cmd understands — so the path must not appear on the line at all. It
    // travels via the environment instead: %VAR% expands once, after the
    // line is tokenized into commands, so every metacharacter in the value
    // stays literal.
    return [
      [
        "cmd",
        ["/c", "start", '""', '"%SVERKA_VIEW_TARGET%"'],
        {
          windowsVerbatimArguments: true,
          env: { ...process.env, SVERKA_VIEW_TARGET: path },
        },
      ],
    ];
  }
  return isWsl()
    ? [
        ["wslview", [path]],
        ["xdg-open", [path]],
      ]
    : [["xdg-open", [path]]];
}

/** Open a file with the platform's default handler. Returns false when no
 *  opener binary exists or every attempt failed — callers print the path. */
export function openReportInBrowser(path: string): boolean {
  for (const [cmd, args, options] of openerCandidates(path)) {
    const res = spawnSync(cmd, args, {
      stdio: "ignore",
      timeout: 5000,
      ...options,
    });
    if (res.error === undefined && res.status === 0) return true;
  }
  return false;
}
