import { describe, it, expect, afterEach } from "vitest";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { findConfig } from "../index.js";
import { makeTempDir, cleanupTempDir, writeSimpleConfig, writeJsConfig, writeNestedConfig } from "./helpers/fixtures.js";

describe("findConfig", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map(cleanupTempDir));
  });

  it("finds sverka.config.ts in root", async () => {
    const dir = await makeTempDir();
    dirs.push(dir);
    await writeSimpleConfig(dir);
    const result = await findConfig(dir);
    expect(result).not.toBeNull();
    expect(result).toMatch(/sverka\.config\.ts$/);
  });

  it("finds config in a parent directory", async () => {
    const dir = await makeTempDir();
    dirs.push(dir);
    const deepDir = await writeNestedConfig(dir, 2);
    const result = await findConfig(deepDir);
    expect(result).not.toBeNull();
    expect(result).toMatch(/sverka\.config\.ts$/);
  });

  it("falls back to sverka.config.js", async () => {
    const dir = await makeTempDir();
    dirs.push(dir);
    await writeJsConfig(dir);
    const result = await findConfig(dir);
    expect(result).not.toBeNull();
    expect(result).toMatch(/sverka\.config\.js$/);
  });

  it("returns null when the config is beyond 5 parent levels", async () => {
    const dir = await makeTempDir();
    dirs.push(dir);
    // Config lives at the temp root; search starts 7 levels below it.
    await writeSimpleConfig(dir);
    let deep = dir;
    for (let i = 0; i < 7; i++) {
      deep = join(deep, `level${i}`);
      await mkdir(deep, { recursive: true });
    }
    const result = await findConfig(deep);
    expect(result).toBeNull();
  });

  it("prefers .ts over .js in the same directory", async () => {
    const dir = await makeTempDir();
    dirs.push(dir);
    await writeSimpleConfig(dir);
    await writeJsConfig(dir);
    const result = await findConfig(dir);
    expect(result).not.toBeNull();
    expect(result).toMatch(/sverka\.config\.ts$/);
  });
});
