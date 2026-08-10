import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  makeTempDir,
  cleanupTempDir,
} from "./helpers/fixtures.js";

const BIN_PATH = join(import.meta.dirname, "..", "..", "dist", "bin.mjs");

describe("sverka binary (acceptance)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it("spawns and creates a config file via `init`", () => {
    if (!existsSync(BIN_PATH)) {
      it.skip("dist/bin.mjs not built — run `bun run build` first");
      return;
    }
    const result = spawnSync("node", [BIN_PATH, "init", "--root", dir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(result.status).toBe(0);
    expect(existsSync(join(dir, "sverka.config.ts"))).toBe(true);
  });

  it("exits with 2 for unknown command", () => {
    if (!existsSync(BIN_PATH)) {
      it.skip("dist/bin.mjs not built — run `bun run build` first");
      return;
    }
    const result = spawnSync("node", [BIN_PATH, "frobnicate", "--root", dir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(result.status).toBe(2);
  });

  it("exits with 0 for doctor", () => {
    if (!existsSync(BIN_PATH)) {
      it.skip("dist/bin.mjs not built — run `bun run build` first");
      return;
    }
    const result = spawnSync("node", [BIN_PATH, "doctor", "--root", dir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(result.status).toBe(0);
  });
});
