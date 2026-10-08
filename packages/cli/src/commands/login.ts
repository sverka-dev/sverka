// login command — store a hub token in ~/.config/sverka/credentials.
// Spec 55: `sverka login --hub <url> --token <t>`, file mode 0600.
// SVERKA_HUB_URL / SVERKA_HUB_TOKEN env vars supply defaults.

import type { GlobalFlags, OutputWriter } from "../types.js";
import { CliError, ExitCode } from "../types.js";
import { normalizeHubUrl, storeCredentials } from "../internal/hub.js";

export interface LoginArgs {
  hub?: string;
  token?: string;
}

export async function loginCommand(
  args: LoginArgs,
  _global: GlobalFlags,
  output: OutputWriter,
  _start: number,
): Promise<number> {
  const url = args.hub ?? process.env["SVERKA_HUB_URL"];
  const token = args.token ?? process.env["SVERKA_HUB_TOKEN"];
  if (url === undefined) {
    throw new CliError(
      "missing --hub <url> (or set SVERKA_HUB_URL)",
      "MISSING_ARG",
      ExitCode.UsageError,
    );
  }
  if (token === undefined) {
    throw new CliError(
      "missing --token <t> (or set SVERKA_HUB_TOKEN)",
      "MISSING_ARG",
      ExitCode.UsageError,
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new CliError(
      `--hub must be a URL, got "${url}"`,
      "INVALID_FLAG",
      ExitCode.UsageError,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new CliError(
      `--hub must be http(s), got "${parsed.protocol}"`,
      "INVALID_FLAG",
      ExitCode.UsageError,
    );
  }
  const normalized = normalizeHubUrl(url);
  const path = storeCredentials(normalized, token);
  output.writeLine(`stored credentials for ${normalized} in ${path}`);
  return ExitCode.Success;
}
