// Assemble ReportContext for the HTML report — git facts, CI links.
// Everything is best-effort: missing git/CI info simply produces
// fewer rows, never a failure.

import { spawnSync } from "node:child_process";
import process from "node:process";
import type { ReportContext } from "@sverka/reporter";

function git(root: string, ...args: string[]): string | undefined {
  const res = spawnSync(
    "git", // NOSONAR — argv form, no shell; fixed binary name
    args,
    {
      cwd: root,
      encoding: "utf-8",
      // Best-effort context — a slow/blocked git must not stall the run.
      timeout: 2000,
    },
  );
  const out = res.status === 0 ? res.stdout?.trim() : undefined;
  return out || undefined;
}

/** Normalize a git remote URL (ssh or https) to a clickable web URL.
 * Credentials embedded in https remotes (user:token@host) are stripped. */
function repoWebUrl(remote?: string): string | undefined {
  if (!remote) return undefined;
  const ssh = /^git@([^:]+):(.+?)(\.git)?$/.exec(remote);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  try {
    const url = new URL(remote);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    url.username = "";
    url.password = "";
    url.pathname = url.pathname.replace(/\.git$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function collectLinks(
  repo: string | undefined,
  commit: string | undefined,
): { label: string; url: string }[] {
  const links: { label: string; url: string }[] = [];
  if (repo) links.push({ label: "Repo", url: repo });
  if (repo && commit)
    links.push({ label: "Commit", url: `${repo}/commit/${commit}` });
  if (repo && process.env.GITHUB_RUN_ID)
    links.push({
      label: "CI run",
      url: `${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`,
    });
  return links;
}

export function collectReportContext(
  root: string,
  command: string,
): ReportContext {
  const env = process.env;
  const ghRepo =
    env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY
      ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}`
      : undefined;
  const repo = ghRepo ?? repoWebUrl(git(root, "remote", "get-url", "origin"));
  const commit = env.GITHUB_SHA ?? git(root, "rev-parse", "HEAD");
  const branch =
    env.GITHUB_REF_NAME ?? git(root, "rev-parse", "--abbrev-ref", "HEAD");

  const meta: { label: string; value: string }[] = [
    ...(branch ? [{ label: "Branch", value: branch }] : []),
    { label: "Directory", value: root },
  ];

  return {
    generatedAt: new Date().toISOString(),
    command,
    meta,
    links: collectLinks(repo, commit),
  };
}
