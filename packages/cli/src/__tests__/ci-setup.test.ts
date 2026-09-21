import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectCiSetup } from "../internal/ci-setup.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sverka-ci-setup-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("detectCiSetup", () => {
  it("returns undefined for a project with no Node signals", () => {
    expect(detectCiSetup(dir)).toBeUndefined();
  });

  it("detects bun from bun.lock", () => {
    writeFileSync(join(dir, "bun.lock"), "{}");
    writeFileSync(join(dir, "package.json"), "{}");
    const cfg = detectCiSetup(dir);
    expect(cfg?.setup?.[0]).toMatchObject({ uses: "oven-sh/setup-bun@v2" });
    expect(cfg?.setup?.[1]).toMatchObject({ run: "bun install --frozen-lockfile" });
  });

  it("packageManager field wins over lockfiles", () => {
    writeFileSync(join(dir, "package-lock.json"), "{}");
    writeFileSync(join(dir, "package.json"), JSON.stringify({ packageManager: "pnpm@9.0.0" }));
    const cfg = detectCiSetup(dir);
    expect(cfg?.setup?.[0]).toMatchObject({ uses: "pnpm/action-setup@v4" });
  });

  it("uses npm ci when package-lock exists, npm install otherwise", () => {
    writeFileSync(join(dir, "package.json"), "{}");
    writeFileSync(join(dir, "package-lock.json"), "{}");
    expect(detectCiSetup(dir)?.setup?.at(-1)).toMatchObject({ run: "npm ci" });
  });

  it("emits recursive submodule checkout when .gitmodules exists", () => {
    writeFileSync(join(dir, ".gitmodules"), "[submodule]");
    const cfg = detectCiSetup(dir);
    expect(cfg?.checkoutWith).toEqual({ submodules: "recursive" });
    expect(cfg?.setup).toBeUndefined();
  });
});
