// Hub connection resolution (Spec 55) — credentials file, env vars, and
// the per-repo `.sverka/hub.json` config.
//
// Precedence:
//   url:     SVERKA_HUB_URL > .sverka/hub.json
//   token:   SVERKA_HUB_TOKEN > ~/.config/sverka/credentials
//   project: .sverka/hub.json > git remote slug > dir basename

import {
  existsSync,
  mkdirSync,
  chmodSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import type { RemoteStoreConfig } from "@sverka/storage";

/** Parsed `.sverka/hub.json` — `{ "remote": {...} }` or flat. */
export interface HubFileConfig {
  readonly url?: string | undefined;
  readonly project?: string | undefined;
  /** `enabled: true` activates remote behaviour without `--remote`. */
  readonly enabled?: boolean | undefined;
  readonly cache?: boolean | undefined;
  readonly upload?: boolean | undefined;
}

export interface ResolvedHub {
  readonly config: RemoteStoreConfig;
  readonly cache: boolean;
  readonly upload: boolean;
  readonly enabled: boolean;
}

function configHome(): string {
  const xdg = process.env["XDG_CONFIG_HOME"];
  return typeof xdg === "string" && xdg !== ""
    ? xdg
    : join(homedir(), ".config");
}

export function credentialsPath(): string {
  return join(configHome(), "sverka", "credentials");
}

interface CredentialsFile {
  readonly hubs?: Record<string, string>;
}

function readCredentials(): CredentialsFile {
  try {
    const text = readFileSync(credentialsPath(), "utf8");
    const parsed = JSON.parse(text) as CredentialsFile;
    if (typeof parsed === "object" && parsed !== null) return parsed;
  } catch {
    // Missing or unreadable file — no stored credentials.
  }
  return {};
}

/**
 * Store a hub token at `~/.config/sverka/credentials` with mode 0600.
 * The file is a JSON map keyed by hub URL so multiple hubs coexist.
 */
export function storeCredentials(url: string, token: string): string {
  const path = credentialsPath();
  const existing = readCredentials();
  const hubs = { ...(existing.hubs ?? {}), [url]: token };
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify({ hubs }, null, 2)}\n`, {
    mode: 0o600,
  });
  // writeFileSync mode applies only on create — force it for a file that
  // already existed with looser permissions.
  chmodSync(path, 0o600);
  return path;
}

function storedTokenFor(url: string): string | undefined {
  return readCredentials().hubs?.[url];
}

/** Read `.sverka/hub.json` when present. Malformed JSON is ignored. */
export function readHubFileConfig(root: string): HubFileConfig {
  const path = join(root, ".sverka", "hub.json");
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};
    const outer = parsed as { remote?: unknown } & HubFileConfig;
    const inner =
      typeof outer.remote === "object" && outer.remote !== null
        ? (outer.remote as HubFileConfig)
        : outer;
    return {
      url: typeof inner.url === "string" ? inner.url : undefined,
      project: typeof inner.project === "string" ? inner.project : undefined,
      enabled: inner.enabled === true,
      cache: typeof inner.cache === "boolean" ? inner.cache : undefined,
      upload: typeof inner.upload === "boolean" ? inner.upload : undefined,
    };
  } catch {
    return {};
  }
}

/** Derive "owner/repo" from `git remote.origin.url`; falls back to the
 *  directory basename when there is no usable remote. */
export function projectSlug(root: string): string {
  try {
    const url = execFileSync(
      "git", // NOSONAR — argv form, no shell; fixed binary name
      ["config", "--get", "remote.origin.url"],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    const ssh = /^[^@]+@[^:]+:(.+)$/.exec(url);
    const path = (ssh?.[1] ?? new URL(url).pathname).replace(/\.git$/, "");
    const slug = path.replace(/^\/+/, "");
    if (slug !== "") return slug;
  } catch {
    // No git, no remote, unparsable URL — fall through.
  }
  return basename(resolve(root));
}

function envString(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Canonical credential key — `sverka login` stores tokens under the URL
 *  with trailing slashes stripped; lookups must normalize identically. */
export function normalizeHubUrl(url: string): string {
  let end = url.length;
  while (end > 0 && url.charCodeAt(end - 1) === 0x2f) end--;
  return url.slice(0, end);
}

/**
 * Resolve the effective hub connection for a root. Returns null when no
 * hub is configured at all (no url, no token anywhere) — the caller then
 * treats `--remote` as a usage error and a bare `run` stays local.
 */
export function resolveHub(root: string): ResolvedHub | null {
  const file = readHubFileConfig(root);
  const rawUrl = envString("SVERKA_HUB_URL") ?? file.url;
  const url = rawUrl !== undefined ? normalizeHubUrl(rawUrl) : undefined;
  const token =
    envString("SVERKA_HUB_TOKEN") ??
    (url !== undefined ? storedTokenFor(url) : undefined);
  if (url === undefined || token === undefined) return null;
  return {
    config: { url, token, project: file.project ?? projectSlug(root) },
    cache: file.cache ?? true,
    upload: file.upload ?? true,
    enabled: file.enabled === true,
  };
}
