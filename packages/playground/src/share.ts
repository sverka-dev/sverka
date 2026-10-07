// Share links (Spec 53): a ShareableRun serializes into the URL fragment —
// `#c=` keeps payloads out of server logs and needs zero backend.
// Encoding: JSON → deflate-raw → base64url.

import { deflateSync, inflateSync } from "fflate";
import type { Finding } from "./types.js";

export interface ShareableRun {
  readonly schema: "sverka.playground/v1";
  readonly code: string;
  readonly findings?: readonly Finding[];
}

export type PlaygroundErrorCode =
  "TRANSPILE_FAILED" | "DECODE_FAILED" | "PAYLOAD_TOO_LARGE";

export class PlaygroundError extends Error {
  readonly code: PlaygroundErrorCode;
  constructor(code: PlaygroundErrorCode, message: string) {
    super(message);
    this.name = "PlaygroundError";
    this.code = code;
  }
}

/** Fragment lengths are browser-dependent; warn past 32 KB of payload. */
export const SHARE_PAYLOAD_WARN_BYTES = 32 * 1024;

const SHARE_PREFIX = "#c=";

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replaceAll("-", "+").replaceAll("_", "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Encode a run into a share link. `base` is the page URL the link targets
 *  (`location.origin + location.pathname` at runtime). */
export function encodeShareLink(run: ShareableRun, base = ""): string {
  const payload = toBase64Url(
    deflateSync(new TextEncoder().encode(JSON.stringify(run))),
  );
  return `${base}${SHARE_PREFIX}${payload}`;
}

/** Decode a `#c=` fragment back into a ShareableRun. Corrupt payloads throw
 *  PlaygroundError(DECODE_FAILED) — callers fall back to the default template. */
export function decodeShareLink(hash: string): ShareableRun {
  const marker = hash.indexOf(SHARE_PREFIX);
  const fragment =
    marker >= 0
      ? hash.slice(marker + SHARE_PREFIX.length)
      : hash.startsWith("#")
        ? hash.slice(1)
        : hash;
  try {
    const json = new TextDecoder().decode(inflateSync(fromBase64Url(fragment)));
    const parsed: unknown = JSON.parse(json);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as ShareableRun).schema !== "sverka.playground/v1" ||
      typeof (parsed as ShareableRun).code !== "string"
    ) {
      throw new Error("payload is not a sverka.playground/v1 run");
    }
    return parsed as ShareableRun;
  } catch (e) {
    throw new PlaygroundError(
      "DECODE_FAILED",
      `share link could not be decoded: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
