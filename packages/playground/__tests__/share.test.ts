import { describe, it, expect } from "vitest";
import { deflateSync } from "fflate";
import {
  encodeShareLink,
  decodeShareLink,
  PlaygroundError,
  SHARE_PAYLOAD_WARN_BYTES,
} from "../src/index.js";
import type { Finding, ShareableRun } from "../src/index.js";

const finding: Finding = {
  id: "f1",
  fingerprint: "fp1",
  checkId: "lint",
  severity: "high",
  confidence: 1,
  message: "x is unused",
  rule: "no-unused-vars",
  file: "src/index.ts",
  startLine: 5,
  endLine: 5,
  source: {
    tool: "playground",
    version: null,
    format: "custom",
    originalRuleId: "no-unused-vars",
    originalSeverity: null,
  },
};

const baseRun: ShareableRun = {
  schema: "sverka.playground/v1",
  code: "const proj = new Project('demo');",
};

describe("share links (spec 53)", () => {
  it("round-trips code only", () => {
    const url = encodeShareLink(baseRun);
    expect(url.startsWith("#c=")).toBe(true);
    const decoded = decodeShareLink(url);
    expect(decoded).toEqual(baseRun);
  });

  it("round-trips code + findings", () => {
    const run: ShareableRun = { ...baseRun, findings: [finding] };
    const decoded = decodeShareLink(encodeShareLink(run));
    expect(decoded.code).toBe(run.code);
    expect(decoded.findings).toEqual([finding]);
  });

  it("produces URL-safe output (no +, /, =)", () => {
    // Long code with high-entropy content to exercise the full byte range
    const run: ShareableRun = {
      schema: "sverka.playground/v1",
      code: "x".repeat(5000) + "ÿ\u0000\u00ff" + JSON.stringify({ a: 1 }),
    };
    const payload = encodeShareLink(run).slice(3);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("decodes from a full URL, not just a bare fragment", () => {
    const url = encodeShareLink(baseRun, "https://sverka.dev/playground");
    expect(decodeShareLink(url)).toEqual(baseRun);
  });

  it("rejects corrupt payloads with DECODE_FAILED", () => {
    expect(() => decodeShareLink("#c=not-valid-base64!!!")).toThrow(
      PlaygroundError,
    );
    try {
      decodeShareLink("#c=not-valid-base64!!!");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PlaygroundError);
      expect((e as PlaygroundError).code).toBe("DECODE_FAILED");
    }
  });

  it("rejects a different schema version", () => {
    const fake = encodeShareLink({
      schema: "sverka.playground/v99",
      code: "x",
    } as unknown as ShareableRun);
    expect(() => decodeShareLink(fake)).toThrow(PlaygroundError);
  });

  it("warn threshold constant is exported and positive", () => {
    expect(SHARE_PAYLOAD_WARN_BYTES).toBe(32 * 1024);
  });

  it("round-trips payloads of every padding length (browser atob is strict)", () => {
    for (let i = 0; i < 12; i++) {
      const run: ShareableRun = {
        schema: "sverka.playground/v1",
        code: "x".repeat(i * 7 + 1),
      };
      expect(decodeShareLink(encodeShareLink(run))).toEqual(run);
    }
  });

  it("decodes fragments containing base64url - and _ characters", () => {
    // Craft a payload whose deflate output produces -/_ under base64url —
    // scanned deterministically over fixed candidates.
    let payload = "";
    for (let i = 0; i < 10000; i++) {
      const json = JSON.stringify({
        schema: "sverka.playground/v1",
        code: `probe-${i}-${String.fromCharCode(...Array.from({ length: 64 }, (_, j) => (i * 31 + j * 17) % 256))}`,
      });
      const b64url = Buffer.from(deflateSync(new TextEncoder().encode(json)))
        .toString("base64")
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/, "");
      if (b64url.includes("-") && b64url.includes("_")) {
        payload = b64url;
        break;
      }
    }
    expect(payload).not.toBe("");
    const decoded = decodeShareLink(`#c=${payload}`);
    expect(decoded.code).toContain("probe-");
  });

  it("rejects findings: null and malformed finding shapes", () => {
    const mk = (findings: unknown): string => {
      const json = JSON.stringify({
        schema: "sverka.playground/v1",
        code: "x",
        findings,
      });
      // hand-encode the way encodeShareLink does
      const b64url = Buffer.from(
        deflateSync(new TextEncoder().encode(json)),
      ).toString("base64url");
      return `#c=${b64url}`;
    };
    expect(() => decodeShareLink(mk(null))).toThrow(PlaygroundError);
    expect(() =>
      decodeShareLink(mk([{ rule: "r", file: "f", startLine: "not-a-num" }])),
    ).toThrow(PlaygroundError);
    // valid findings still decode
    const ok = decodeShareLink(mk([finding]));
    expect(ok.findings).toEqual([finding]);
  });

  it("refuses inflated payloads past the cap (deflate bomb)", () => {
    const run: ShareableRun = {
      schema: "sverka.playground/v1",
      code: "x".repeat(2 * 1024 * 1024),
    };
    // ~2 MB of JSON compresses to ~2 KB — tiny link, huge inflation.
    const url = encodeShareLink(run);
    expect(url.length).toBeLessThan(SHARE_PAYLOAD_WARN_BYTES);
    try {
      decodeShareLink(url);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PlaygroundError);
      expect((e as PlaygroundError).code).toBe("PAYLOAD_TOO_LARGE");
    }
  });
});
