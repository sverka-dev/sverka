import { describe, it, expect, afterAll, vi } from "vitest";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Stats } from "node:fs";

import { ArenaError } from "../src/config.js";
import { ensurePrivateDir } from "../src/internal/private-dir.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const orig = await importOriginal<typeof import("node:fs/promises")>();
  return { ...orig, lstat: vi.fn(orig.lstat) };
});

const dir = mkdtempSync(join(tmpdir(), "arena-privdir-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const WHAT = "test cache";
const CODE = "PACK_NOT_FOUND";

describe("ensurePrivateDir", () => {
  it("creates a missing dir owner-only", async () => {
    const target = join(dir, "fresh");
    await ensurePrivateDir(target, WHAT, CODE);
    const st = lstatSync(target);
    expect(st.isDirectory()).toBe(true);
    if (typeof process.getuid === "function") {
      expect(st.mode & 0o777).toBe(0o700);
    }
  });

  it("accepts an existing owner-only dir", async () => {
    const target = join(dir, "ours");
    mkdirSync(target, { mode: 0o700 });
    await expect(ensurePrivateDir(target, WHAT, CODE)).resolves.toBeUndefined();
  });

  it("refuses a regular file", async () => {
    const target = join(dir, "file");
    writeFileSync(target, "x");
    const err = await ensurePrivateDir(target, WHAT, CODE).catch(
      (e) => e as ArenaError,
    );
    expect(err).toBeInstanceOf(ArenaError);
    expect(err.code).toBe(CODE);
    expect(err.message).toContain("not a directory");
  });

  it("refuses a symlink instead of following it", async () => {
    const real = join(dir, "link-target");
    mkdirSync(real, { mode: 0o700 });
    const link = join(dir, "link");
    symlinkSync(real, link);
    const err = await ensurePrivateDir(link, WHAT, CODE).catch(
      (e) => e as ArenaError,
    );
    expect(err).toBeInstanceOf(ArenaError);
    expect(err.message).toContain("not a directory");
    // The target must be untouched — its mode stays as created.
    expect(lstatSync(real).mode & 0o777).toBe(0o700);
  });

  it.skipIf(process.platform === "win32")(
    "refuses a dir accessible by group/other",
    async () => {
      const target = join(dir, "loose");
      mkdirSync(target);
      chmodSync(target, 0o755);
      const err = await ensurePrivateDir(target, WHAT, CODE).catch(
        (e) => e as ArenaError,
      );
      expect(err).toBeInstanceOf(ArenaError);
      expect(err.message).toContain("accessible by group/other");
    },
  );

  it.skipIf(process.platform === "win32")(
    "refuses a dir owned by another uid",
    async () => {
      const target = join(dir, "foreign");
      mkdirSync(target, { mode: 0o700 });
      // We cannot chown without privileges — report a foreign uid via
      // the lstat seam instead.
      vi.mocked(lstat).mockResolvedValueOnce({
        isDirectory: () => true,
        uid: (process.getuid?.() ?? 0) + 1,
        mode: 0o40700,
      } as Stats);
      const err = await ensurePrivateDir(target, WHAT, CODE).catch(
        (e) => e as ArenaError,
      );
      expect(err).toBeInstanceOf(ArenaError);
      expect(err.message).toContain("owned by uid");
    },
  );

  it("reuses the same dir twice without complaint", async () => {
    const target = join(dir, "twice");
    await ensurePrivateDir(target, WHAT, CODE);
    await expect(ensurePrivateDir(target, WHAT, CODE)).resolves.toBeUndefined();
    expect(existsSync(target)).toBe(true);
  });
});
