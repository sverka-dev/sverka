// runs command — list run history. Default: local .sverka/runs reports;
// --remote lists the hub's stored runs for this project (Spec 55).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { GlobalFlags, OutputWriter } from "../types.js";
import { CliError, ExitCode } from "../types.js";
import { resolveHub } from "../internal/hub.js";

export interface RunsArgs {
  remote?: boolean;
  limit?: number;
}

interface LocalRunRow {
  readonly runId: string;
  readonly status: string;
  readonly findings: number | null;
  readonly mtimeMs: number;
}

function listLocalRuns(root: string): LocalRunRow[] {
  const dir = join(root, ".sverka", "runs");
  if (!existsSync(dir)) return [];
  const rows: LocalRunRow[] = [];
  for (const entry of readdirSync(dir)) {
    const reportPath = join(dir, entry, "report.json");
    if (!existsSync(reportPath)) continue;
    let status = "unknown";
    let findings: number | null = null;
    try {
      const payload = JSON.parse(readFileSync(reportPath, "utf8")) as {
        data?: { status?: unknown; findings?: unknown };
      };
      const data = payload.data ?? {};
      if (typeof data.status === "string") status = data.status;
      if (typeof data.findings === "number") findings = data.findings;
    } catch {
      // Corrupt report — still list the run id.
    }
    rows.push({
      runId: entry,
      status,
      findings,
      mtimeMs: statSync(reportPath).mtimeMs,
    });
  }
  return rows.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export async function runsCommand(
  args: RunsArgs,
  global: GlobalFlags,
  output: OutputWriter,
  _start: number,
): Promise<number> {
  if (args.remote === true) {
    return remoteRuns(args, global, output);
  }
  return localRuns(args, global, output);
}

async function remoteRuns(
  args: RunsArgs,
  global: GlobalFlags,
  output: OutputWriter,
): Promise<number> {
  const hub = resolveHub(global.root);
  if (hub === null) {
    throw new CliError(
      "no hub configured — set SVERKA_HUB_URL + SVERKA_HUB_TOKEN, run `sverka login`, or add .sverka/hub.json",
      "MISSING_ARG",
      ExitCode.UsageError,
    );
  }
  const { listRuns } = await import("@sverka/storage");
  const runs = await listRuns(hub.config, {
    ...(args.limit !== undefined ? { limit: args.limit } : {}),
  });
  if (global.format === "json") {
    output.writeLine(JSON.stringify({ command: "runs", data: runs }));
    return ExitCode.Success;
  }
  if (runs.length === 0) {
    output.writeLine(
      `no remote runs for ${hub.config.project} — run \`sverka run --remote\` to upload one`,
    );
    return ExitCode.Success;
  }
  output.writeLine(`remote runs for ${hub.config.project} (${hub.config.url})`);
  for (const run of runs) {
    const when =
      run.startedAt === null
        ? "—"
        : new Date(run.startedAt).toISOString().slice(0, 19) + "Z";
    const duration =
      run.durationMs === null ? "—" : `${(run.durationMs / 1000).toFixed(1)}s`;
    output.writeLine(
      `  ${run.runId}  ${run.status.padEnd(9)} ${run.entry.padEnd(20)} ${when}  ${duration}  findings:${run.findingCounts.total}`,
    );
  }
  return ExitCode.Success;
}

// Local listing — .sverka/runs/<runId>/report.json
function localRuns(
  args: RunsArgs,
  global: GlobalFlags,
  output: OutputWriter,
): number {
  const runs = listLocalRuns(global.root);
  const shown = runs.slice(0, args.limit ?? 20);
  if (global.format === "json") {
    output.writeLine(JSON.stringify({ command: "runs", data: shown }));
    return ExitCode.Success;
  }
  if (shown.length === 0) {
    output.writeLine("no runs recorded — run `sverka run` first");
    return ExitCode.Success;
  }
  for (const run of shown) {
    const when = new Date(run.mtimeMs).toISOString().slice(0, 19) + "Z";
    output.writeLine(
      `  ${run.runId}  ${run.status.padEnd(9)} ${when}  findings:${run.findings ?? "—"}`,
    );
  }
  return ExitCode.Success;
}
