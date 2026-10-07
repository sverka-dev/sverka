// Share links (Spec 53): a ShareableRun serializes into the URL fragment —
// `#c=` keeps payloads out of server logs and needs zero backend.
// Encoding: JSON → deflate-raw → base64url.

import { deflateSync, Inflate } from "fflate";
import type { Finding, Severity } from "./types.js";

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

/** Hard cap on inflated share payloads — a compressed fragment is cheap to
 *  craft into a deflate bomb, so decoding refuses past 1 MB of JSON. */
const SHARE_MAX_INFLATED_BYTES = 1024 * 1024;

const SHARE_PREFIX = "#c=";

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replaceAll("-", "+").replaceAll("_", "/");
  // Browser atob() is strict about padding — restore what the encoder
  // stripped. (Node's atob tolerates missing padding, which is why the
  // round-trip test alone did not catch this.)
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Inflate with a hard output cap — bounded memory on hostile payloads. */
function inflateBounded(bytes: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let overflow = false;
  const inflate = new Inflate((chunk) => {
    total += chunk.length;
    if (total > SHARE_MAX_INFLATED_BYTES) {
      overflow = true;
      return;
    }
    chunks.push(chunk);
  });
  inflate.push(bytes, true);
  if (overflow) {
    throw new PlaygroundError(
      "PAYLOAD_TOO_LARGE",
      `share link inflates past ${SHARE_MAX_INFLATED_BYTES} bytes`,
    );
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

const SEVERITIES: readonly string[] = [
  "info",
  "low",
  "medium",
  "high",
  "critical",
];

/** Structural check — a shared finding reaches the HTML report, so every
 *  field that gets rendered must be the expected scalar. */
function isFindingShape(v: unknown): v is Finding {
  if (typeof v !== "object" || v === null) return false;
  const f = v as Record<string, unknown>;
  return (
    typeof f.rule === "string" &&
    typeof f.file === "string" &&
    typeof f.message === "string" &&
    typeof f.severity === "string" &&
    SEVERITIES.includes(f.severity as Severity) &&
    typeof f.startLine === "number" &&
    Number.isFinite(f.startLine) &&
    typeof f.endLine === "number" &&
    Number.isFinite(f.endLine)
  );
}

/** Encode a run into a share link. `base` is the page URL the link targets
 *  (`location.origin + location.pathname` at runtime). */
export function encodeShareLink(run: ShareableRun, base = ""): string {
  const payload = toBase64Url(
    deflateSync(new TextEncoder().encode(JSON.stringify(run))),
  );
  return `${base}${SHARE_PREFIX}${payload}`;
}

/** Decode a `#c=` fragment back into a ShareableRun. Corrupt, oversized, or
 *  shape-invalid payloads throw PlaygroundError — callers fall back to the
 *  default template. */
export function decodeShareLink(hash: string): ShareableRun {
  const marker = hash.indexOf(SHARE_PREFIX);
  const fragment =
    marker >= 0
      ? hash.slice(marker + SHARE_PREFIX.length)
      : hash.startsWith("#")
        ? hash.slice(1)
        : hash;
  try {
    const json = new TextDecoder().decode(
      inflateBounded(fromBase64Url(fragment)),
    );
    const parsed: unknown = JSON.parse(json);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as ShareableRun).schema !== "sverka.playground/v1" ||
      typeof (parsed as ShareableRun).code !== "string"
    ) {
      throw new Error("payload is not a sverka.playground/v1 run");
    }
    const findings = (parsed as ShareableRun).findings;
    if (findings !== undefined) {
      if (!Array.isArray(findings) || !findings.every(isFindingShape)) {
        throw new Error("payload findings failed shape validation");
      }
    }
    return parsed as ShareableRun;
  } catch (e) {
    if (e instanceof PlaygroundError) throw e;
    throw new PlaygroundError(
      "DECODE_FAILED",
      `share link could not be decoded: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
