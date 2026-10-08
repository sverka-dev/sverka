// Token auth — Bearer tokens from a tokens file and/or the admin env var.
// Spec 55: "single read/write token plus optional read-only tokens
// (tokens file: name:token:ro|rw)".

import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { HubToken } from "./types.js";

const TOKENS_FILE = "tokens";

/**
 * Parse a tokens file body: one `name:token:ro|rw` per line; `#` comments
 * and blank lines skipped; malformed lines skipped. Token values are
 * `[A-Za-z0-9._~-]` — anything else is ignored (never echo user data).
 */
export function parseTokensFile(text: string): HubToken[] {
  const tokens: HubToken[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const parts = line.split(":");
    if (parts.length !== 3) continue;
    const [name, token, access] = parts;
    if (
      name === undefined ||
      token === undefined ||
      (access !== "ro" && access !== "rw") ||
      !/^[A-Za-z0-9._~-]{8,}$/.test(token)
    ) {
      continue;
    }
    tokens.push({ name, token, access });
  }
  return tokens;
}

/**
 * Resolve the effective token set: explicit option > tokens file +
 * SVERKA_HUB_ADMIN_TOKEN. When nothing is configured, a fresh admin token
 * is generated, appended to `<dataDir>/tokens`, and returned so the CLI
 * can print it once — an unauthenticated hub is never silently open.
 */
export function resolveTokens(
  dataDir: string,
  explicit?: readonly HubToken[],
): { tokens: readonly HubToken[]; generated: HubToken | null } {
  if (explicit !== undefined && explicit.length > 0) {
    return { tokens: explicit, generated: null };
  }

  const tokens: HubToken[] = [];
  const file = join(dataDir, TOKENS_FILE);
  try {
    if (existsSync(file)) {
      tokens.push(...parseTokensFile(readFileSync(file, "utf8")));
    }
  } catch {
    // Unreadable tokens file — fall through to env/generated.
  }

  const admin = process.env["SVERKA_HUB_ADMIN_TOKEN"];
  if (typeof admin === "string" && admin.length >= 8) {
    tokens.push({ name: "admin-env", token: admin, access: "rw" });
  }

  if (tokens.length === 0) {
    const generated: HubToken = {
      name: "admin",
      token: `svk_${randomBytes(24).toString("base64url")}`,
      access: "rw",
    };
    try {
      mkdirSync(dataDir, { recursive: true, mode: 0o700 });
      appendFileSync(
        file,
        `${generated.name}:${generated.token}:${generated.access}\n`,
        { mode: 0o600 },
      );
    } catch {
      // If the file can't be written, still serve with the in-memory token —
      // the operator saw it printed on the console.
    }
    tokens.push(generated);
    return { tokens, generated };
  }

  return { tokens, generated: null };
}

/** Extract the bearer token from Authorization, `?token=`, or the
 *  `hub_token` cookie (the dashboard sets it from `?token=`). */
export function extractToken(
  req: {
    headers: {
      authorization?: string | undefined;
      cookie?: string | undefined;
    };
  },
  query: URLSearchParams,
): { token: string | null; viaQuery: boolean } {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return { token: auth.slice("Bearer ".length), viaQuery: false };
  }
  const queryToken = query.get("token");
  if (queryToken !== null && queryToken !== "") {
    return { token: queryToken, viaQuery: true };
  }
  const cookie = req.headers.cookie;
  if (typeof cookie === "string") {
    for (const part of cookie.split(";")) {
      const [k, ...rest] = part.trim().split("=");
      if (k === "hub_token") {
        return { token: rest.join("="), viaQuery: false };
      }
    }
  }
  return { token: null, viaQuery: false };
}
