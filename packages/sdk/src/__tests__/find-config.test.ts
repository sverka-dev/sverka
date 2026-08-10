import { describe, it, expect, afterEach } from "vitest";
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

  it("returns null when no config exists within 5 levels", async () => {
    const dir = await makeTempDir();
    dirs.push(dir);
    // Create a deep nested structure (7 levels) with no config.
    let deep = dir;
    for (let i = 0; i < 7; i++) {
      deep = `${deep}/level${i}`;
    }
    const result = await findConfig(deep);
    // The search walks up 5 parents. With 7 levels of nesting, the config
    // would need to be at level >= 2 from root. Since there's no config
    // anywhere, result should be null.
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
