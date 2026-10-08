// apply command — Spec 54 safe-outputs apply stage. The `__apply` job in
// generated CI runs `sverka apply --provider <gitlab|github>`: it reads
// the agent job's `sverka-writes.json` artifact, validates every write
// against the step's declared `WriteDeclaration[]` (SVERKA_WRITE_DECLARATIONS),
// and applies only the supported kinds. Undeclared or unsupported writes
// fail loudly — the apply job never guesses.

import process from "node:process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentWrite } from "@sverka/runtime";
import type { WriteDeclaration } from "@sverka/workflow";
import type { GlobalFlags, OutputWriter } from "../types.js";
import { CliError, ExitCode } from "../types.js";

export interface ApplyArgs {
  provider?: "gitlab" | "github";
  /** Path to the writes artifact (default: <root>/sverka-writes.json). */
  file?: string;
}

const WRITES_FILE = "sverka-writes.json";
const DECLARATIONS_ENV = "SVERKA_WRITE_DECLARATIONS";

/** Write kinds `sverka apply` can execute. Everything else fails loudly. */
const SUPPORTED_WRITE_KINDS = new Set(["comment"]);

export async function applyCommand(
  args: ApplyArgs,
  global: GlobalFlags,
  output: OutputWriter,
  _start: number,
): Promise<number> {
  const provider = args.provider ?? detectProvider();
  const file = args.file ?? join(global.root, WRITES_FILE);

  const writes = await loadWrites(file);
  const declarations = loadDeclarations();

  const applied: string[] = [];
  for (const write of writes) {
    const declared = declarations.some((d) => d.kind === write.kind);
    if (!declared) {
      throw new CliError(
        `sverka apply: write kind '${write.kind}' is not declared in permissions.write (declarations: ${declarations.map((d) => d.kind).join(", ") || "none"})`,
        "PACKAGE_ERROR",
        ExitCode.RuntimeError,
      );
    }
    if (!SUPPORTED_WRITE_KINDS.has(write.kind)) {
      throw new CliError(
        `sverka apply: write kind '${write.kind}' is declared but not supported by sverka apply (supported: ${[...SUPPORTED_WRITE_KINDS].join(", ")})`,
        "PACKAGE_ERROR",
        ExitCode.RuntimeError,
      );
    }
    // Writes apply sequentially on purpose: comments keep their declared
    // order and the first failure stops the batch loudly.
    applied.push(await applyWrite(provider, write, declarations)); // NOSONAR — intentional sequential applies
  }

  const summary = applied.length > 0 ? ` — ${applied.join("; ")}` : "";
  output.writeLine(
    `sverka apply: applied ${applied.length} write(s) via ${provider}${summary}`,
  );
  return ExitCode.Success;
}

function detectProvider(): "gitlab" | "github" {
  if (process.env["GITLAB_CI"] !== undefined || process.env["CI_API_V4_URL"]) {
    return "gitlab";
  }
  if (process.env["GITHUB_ACTIONS"] !== undefined) return "github";
  throw new CliError(
    "sverka apply: --provider is required when CI provider cannot be detected (gitlab|github)",
    "MISSING_ARG",
    ExitCode.UsageError,
  );
}

async function loadWrites(file: string): Promise<readonly AgentWrite[]> {
  let raw: string;
  try {
    raw = await readFile(file, "utf-8");
  } catch {
    throw new CliError(
      `sverka apply: writes artifact not found: ${file} — the agent job must produce ${WRITES_FILE}`,
      "MISSING_ARG",
      ExitCode.RuntimeError,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new CliError(
      `sverka apply: ${WRITES_FILE} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
      "PACKAGE_ERROR",
      ExitCode.RuntimeError,
    );
  }
  const items = extractWritesItems(parsed);
  if (items === undefined) {
    throw new CliError(
      `sverka apply: ${WRITES_FILE} must be an object with a 'writes' array`,
      "PACKAGE_ERROR",
      ExitCode.RuntimeError,
    );
  }
  return items.map((item, i) => {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as { kind?: unknown }).kind !== "string"
    ) {
      throw new CliError(
        `sverka apply: writes[${i}] must be an object with a string 'kind'`,
        "PACKAGE_ERROR",
        ExitCode.RuntimeError,
      );
    }
    return item as AgentWrite;
  });
}

/** The artifact is either a bare array or an object with a 'writes' array. */
function extractWritesItems(parsed: unknown): readonly unknown[] | undefined {
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const w = (parsed as { writes?: unknown }).writes;
  return Array.isArray(w) ? w : undefined;
}

function loadDeclarations(): readonly WriteDeclaration[] {
  const raw = process.env[DECLARATIONS_ENV];
  if (raw === undefined || raw === "") {
    throw new CliError(
      `sverka apply: ${DECLARATIONS_ENV} is not set — the __apply job declares it from permissions.write`,
      "MISSING_ARG",
      ExitCode.RuntimeError,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new CliError(
      `sverka apply: ${DECLARATIONS_ENV} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
      "PACKAGE_ERROR",
      ExitCode.RuntimeError,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new CliError(
      `sverka apply: ${DECLARATIONS_ENV} must be a JSON array of write declarations`,
      "PACKAGE_ERROR",
      ExitCode.RuntimeError,
    );
  }
  return parsed as readonly WriteDeclaration[];
}

async function applyWrite(
  provider: "gitlab" | "github",
  write: AgentWrite,
  declarations: readonly WriteDeclaration[],
): Promise<string> {
  if (write.kind === "comment") {
    return provider === "gitlab"
      ? applyGitlabComment(write, declarations)
      : applyGithubComment(write);
  }
  throw new CliError(
    `sverka apply: write kind '${write.kind}' is not supported`,
    "PACKAGE_ERROR",
    ExitCode.RuntimeError,
  );
}

function requireBody(write: AgentWrite): string {
  if (typeof write.body !== "string" || write.body === "") {
    throw new CliError(
      "sverka apply: comment write requires a non-empty 'body' string",
      "PACKAGE_ERROR",
      ExitCode.RuntimeError,
    );
  }
  return write.body;
}

/**
 * The object kind a comment write targets. `write.on` wins when present
 * (and must be a known kind — anything else fails loudly rather than
 * silently falling back); otherwise the triggering context decides: a
 * forwarded MR_IID means the comment fired on a merge request.
 */
function resolveCommentTarget(write: AgentWrite): "issue" | "merge_request" {
  if (write.on === "issue" || write.on === "merge_request") {
    return write.on;
  }
  if (write.on !== undefined) {
    throw new CliError(
      `sverka apply: comment write 'on' must be issue|merge_request, got '${JSON.stringify(write.on)}'`,
      "PACKAGE_ERROR",
      ExitCode.RuntimeError,
    );
  }
  return process.env["MR_IID"] !== undefined ? "merge_request" : "issue";
}

/**
 * Resolve the target iid for a comment write. When the triggering context
 * supplies an iid (the webhook forwarded MR_IID/ISSUE_IID), it wins — a
 * write.iid that disagrees is model output trying to redirect the comment
 * to another target, which fails loudly.
 */
function requireIid(write: AgentWrite, envKeys: readonly string[]): number {
  const contextRaw = envKeys
    .map((k) => process.env[k])
    .find((v) => v !== undefined && v !== "");
  if (contextRaw !== undefined) {
    const ctx = Number(contextRaw);
    if (!Number.isInteger(ctx) || ctx <= 0) {
      throw new CliError(
        `sverka apply: context iid '${contextRaw}' is not a positive integer`,
        "PACKAGE_ERROR",
        ExitCode.RuntimeError,
      );
    }
    if (write.iid !== undefined && Number(write.iid) !== ctx) {
      throw new CliError(
        `sverka apply: write iid '${JSON.stringify(write.iid)}' does not match the triggering context iid ${ctx}`,
        "PACKAGE_ERROR",
        ExitCode.RuntimeError,
      );
    }
    return ctx;
  }
  if (write.iid === undefined) {
    throw new CliError(
      `sverka apply: comment write needs a target iid (${envKeys.join(" or ")} env var, or an 'iid' field)`,
      "PACKAGE_ERROR",
      ExitCode.RuntimeError,
    );
  }
  const n = Number(write.iid);
  if (!Number.isInteger(n) || n <= 0) {
    throw new CliError(
      `sverka apply: comment write iid must be a positive integer, got '${JSON.stringify(write.iid)}'`,
      "PACKAGE_ERROR",
      ExitCode.RuntimeError,
    );
  }
  return n;
}

async function applyGitlabComment(
  write: AgentWrite,
  declarations: readonly WriteDeclaration[],
): Promise<string> {
  const env = process.env;
  const api = env["CI_API_V4_URL"] ?? "https://gitlab.com/api/v4";
  const project = env["CI_PROJECT_ID"];
  if (project === undefined || project === "") {
    throw new CliError(
      "sverka apply: CI_PROJECT_ID is not set — run inside a GitLab job or set it explicitly",
      "MISSING_ARG",
      ExitCode.RuntimeError,
    );
  }
  const token = env["SVERKA_APPLY_TOKEN"] || env["GITLAB_TOKEN"];
  if (token === undefined || token === "") {
    throw new CliError(
      "sverka apply: SVERKA_APPLY_TOKEN is not set — scope it to the 'sverka-apply' environment (see engdocs/user/gitlab/agentic.md)",
      "MISSING_ARG",
      ExitCode.RuntimeError,
    );
  }
  const body = requireBody(write);
  const on = resolveCommentTarget(write);
  // Model output is untrusted: a comment write may only target an object
  // kind a WriteDeclaration declared.
  if (!declarations.some((d) => d.kind === "comment" && d.target === on)) {
    throw new CliError(
      `sverka apply: comment write targets '${on}' but no declaration declares it (declared comment targets: ${
        declarations
          .filter((d) => d.kind === "comment")
          .map((d) => d.target)
          .join(", ") || "none"
      })`,
      "PACKAGE_ERROR",
      ExitCode.RuntimeError,
    );
  }
  const iid = requireIid(
    write,
    on === "merge_request" ? ["MR_IID"] : ["ISSUE_IID", "SVERKA_ISSUE_IID"],
  );
  const path =
    on === "merge_request"
      ? `/projects/${encodeURIComponent(project)}/merge_requests/${iid}/notes`
      : `/projects/${encodeURIComponent(project)}/issues/${iid}/notes`;
  await postJson(`${api}${path}`, token, { body }, "PRIVATE-TOKEN");
  return `comment on ${on} !${iid}`;
}

async function applyGithubComment(write: AgentWrite): Promise<string> {
  const env = process.env;
  const api = env["GITHUB_API_URL"] ?? "https://api.github.com";
  const repo = env["GITHUB_REPOSITORY"];
  if (repo === undefined || repo === "") {
    throw new CliError(
      "sverka apply: GITHUB_REPOSITORY is not set — run inside a GitHub Actions job or set it explicitly",
      "MISSING_ARG",
      ExitCode.RuntimeError,
    );
  }
  const token =
    env["SVERKA_APPLY_TOKEN"] || env["GH_TOKEN"] || env["GITHUB_TOKEN"];
  if (token === undefined || token === "") {
    throw new CliError(
      "sverka apply: GH_TOKEN/GITHUB_TOKEN is not set",
      "MISSING_ARG",
      ExitCode.RuntimeError,
    );
  }
  const body = requireBody(write);
  const issue = requireIid(write, ["SVERKA_ISSUE_IID", "ISSUE_IID"]);
  await postJson(
    `${api}/repos/${repo}/issues/${issue}/comments`,
    token,
    { body },
    "Bearer",
  );
  return `comment on issue #${issue}`;
}

async function postJson(
  url: string,
  token: string,
  body: Record<string, unknown>,
  auth: "PRIVATE-TOKEN" | "Bearer",
): Promise<void> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (auth === "PRIVATE-TOKEN") headers["PRIVATE-TOKEN"] = token;
  else headers["authorization"] = `Bearer ${token}`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new CliError(
      `sverka apply: provider request failed (${res.status} ${res.url}): ${text.slice(0, 300)}`,
      "PACKAGE_ERROR",
      ExitCode.RuntimeError,
    );
  }
}
