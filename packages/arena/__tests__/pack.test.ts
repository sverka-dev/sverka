import { describe, it, expect, afterAll } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ArenaError } from "../src/config.js";
import { initPack, lintPack, loadPack, resolvePack } from "../src/pack.js";

const dir = mkdtempSync(join(tmpdir(), "arena-pack-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function expectPackError(
  p: Promise<unknown>,
  code: string,
): Promise<ArenaError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ArenaError);
    expect((e as ArenaError).code).toBe(code);
    return e as ArenaError;
  }
  throw new Error(`expected ArenaError(${code}), got success`);
}

describe("initPack + lintPack", () => {
  it("scaffold passes lint", async () => {
    const packDir = join(dir, "demo");
    await initPack(packDir, "demo");
    expect(existsSync(join(packDir, "pack.json"))).toBe(true);
    expect(existsSync(join(packDir, "tasks", "example-task.json"))).toBe(true);
    const { errors } = await lintPack(packDir);
    expect(errors).toEqual([]);
  });

  it("refuses to scaffold into a non-empty dir", async () => {
    const packDir = join(dir, "taken");
    mkdirSync(packDir, { recursive: true });
    writeFileSync(join(packDir, "x.txt"), "occupied");
    await expectPackError(initPack(packDir, "taken"), "PACK_INVALID");
  });
});

describe("loadPack", () => {
  it("loads tasks, applies pack defaults, derives ids from filenames", async () => {
    const packDir = join(dir, "loadable");
    mkdirSync(join(packDir, "tasks"), { recursive: true });
    mkdirSync(join(packDir, "fixture-dir"), { recursive: true });
    writeFileSync(
      join(packDir, "pack.json"),
      JSON.stringify({
        name: "loadable",
        defaults: { timeoutMs: 60_000, repetitions: 2 },
      }),
    );
    writeFileSync(
      join(packDir, "tasks", "a.json"),
      JSON.stringify({ prompt: "do a", fixture: "fixture-dir" }),
    );
    writeFileSync(
      join(packDir, "tasks", "b.json"),
      JSON.stringify({
        id: "custom-b",
        prompt: "do b",
        timeoutMs: 5000,
        checks: [{ id: "c1", command: "true" }],
      }),
    );
    const pack = await loadPack(packDir);
    expect(pack.name).toBe("loadable");
    expect(pack.defaults.repetitions).toBe(2);
    const a = pack.tasks.find((t) => t.id === "a")!;
    expect(a.timeoutMs).toBe(60_000); // default applied
    expect(a.fixture).toBe(join(packDir, "fixture-dir"));
    const b = pack.tasks.find((t) => t.id === "custom-b")!;
    expect(b.timeoutMs).toBe(5000); // task override wins
    expect(b.checks![0]).toMatchObject({ id: "c1", command: "true" });
  });

  it("missing pack.json → PACK_NOT_FOUND", async () => {
    await expectPackError(loadPack(join(dir, "nope")), "PACK_NOT_FOUND");
  });

  it("invalid pack.json → PACK_INVALID", async () => {
    const packDir = join(dir, "bad-meta");
    mkdirSync(packDir, { recursive: true });
    writeFileSync(join(packDir, "pack.json"), JSON.stringify({ ver: 1 }));
    await expectPackError(loadPack(packDir), "PACK_INVALID");
  });

  it("a pack with no tasks → PACK_INVALID", async () => {
    const packDir = join(dir, "empty");
    mkdirSync(join(packDir, "tasks"), { recursive: true });
    writeFileSync(join(packDir, "pack.json"), JSON.stringify({ name: "e" }));
    await expectPackError(loadPack(packDir), "PACK_INVALID");
  });

  it("duplicate task ids → PACK_INVALID", async () => {
    const packDir = join(dir, "dupes");
    mkdirSync(join(packDir, "tasks"), { recursive: true });
    writeFileSync(join(packDir, "pack.json"), JSON.stringify({ name: "d" }));
    writeFileSync(
      join(packDir, "tasks", "a.json"),
      JSON.stringify({ id: "same", prompt: "x" }),
    );
    writeFileSync(
      join(packDir, "tasks", "b.json"),
      JSON.stringify({ id: "same", prompt: "y" }),
    );
    const err = await expectPackError(loadPack(packDir), "PACK_INVALID");
    expect(err.message).toContain("same");
  });

  it("missing fixture dir → PACK_INVALID", async () => {
    const packDir = join(dir, "no-fixture");
    mkdirSync(join(packDir, "tasks"), { recursive: true });
    writeFileSync(join(packDir, "pack.json"), JSON.stringify({ name: "n" }));
    writeFileSync(
      join(packDir, "tasks", "a.json"),
      JSON.stringify({ prompt: "x", fixture: "ghost" }),
    );
    await expectPackError(loadPack(packDir), "PACK_INVALID");
  });

  it("fixture + repo together → PACK_INVALID", async () => {
    const packDir = join(dir, "both-seeds");
    mkdirSync(join(packDir, "tasks"), { recursive: true });
    mkdirSync(join(packDir, "fx"), { recursive: true });
    writeFileSync(join(packDir, "pack.json"), JSON.stringify({ name: "b" }));
    writeFileSync(
      join(packDir, "tasks", "a.json"),
      JSON.stringify({
        prompt: "x",
        fixture: "fx",
        repo: "https://example.com/unused.git",
      }),
    );
    const err = await expectPackError(loadPack(packDir), "PACK_INVALID");
    expect(err.message).toContain("fixture");
    expect(err.message).toContain("repo");
  });
});

describe("lintPack", () => {
  it("warns on tasks without checks and on dir/name mismatch", async () => {
    const packDir = join(dir, "warn-dir");
    mkdirSync(join(packDir, "tasks"), { recursive: true });
    writeFileSync(
      join(packDir, "pack.json"),
      JSON.stringify({ name: "different-name" }),
    );
    writeFileSync(
      join(packDir, "tasks", "a.json"),
      JSON.stringify({ prompt: "x" }),
    );
    const { errors, warnings } = await lintPack(packDir);
    expect(errors).toEqual([]);
    expect(warnings.some((w) => w.includes("different-name"))).toBe(true);
    expect(warnings.some((w) => w.includes("no checks"))).toBe(true);
  });

  it("collects errors without stopping at the first", async () => {
    const packDir = join(dir, "multi-err");
    mkdirSync(join(packDir, "tasks"), { recursive: true });
    writeFileSync(join(packDir, "pack.json"), JSON.stringify({ name: "m" }));
    writeFileSync(join(packDir, "tasks", "a.json"), "{bad json");
    writeFileSync(
      join(packDir, "tasks", "b.json"),
      JSON.stringify({ prompt: "" }),
    );
    const { errors } = await lintPack(packDir);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  it("errors when a task sets both fixture and repo", async () => {
    const packDir = join(dir, "lint-both");
    mkdirSync(join(packDir, "tasks"), { recursive: true });
    mkdirSync(join(packDir, "fx"), { recursive: true });
    writeFileSync(
      join(packDir, "pack.json"),
      JSON.stringify({ name: "lint-both" }),
    );
    writeFileSync(
      join(packDir, "tasks", "a.json"),
      JSON.stringify({
        prompt: "x",
        fixture: "fx",
        repo: "https://example.com/r.git",
      }),
    );
    const { errors } = await lintPack(packDir);
    expect(errors.some((e) => e.includes("both 'fixture' and 'repo'"))).toBe(
      true,
    );
  });
});

describe("resolvePack", () => {
  it("resolves a local directory", async () => {
    const packDir = join(dir, "local-pack");
    await initPack(packDir, "local-pack");
    const pack = await resolvePack(packDir);
    expect(pack.name).toBe("local-pack");
    expect(pack.tasks.length).toBe(1);
  });

  it("resolves a bare name via packs/<name>/ in a file registry", async () => {
    const regDir = join(dir, "reg");
    const packDir = join(regDir, "packs", "community-pack");
    await initPack(packDir, "community-pack");
    const pack = await resolvePack("community-pack", { registry: regDir });
    expect(pack.name).toBe("community-pack");
    expect(pack.dir).toBe(packDir);
  });

  it("bare name without a registry → PACK_NOT_FOUND", async () => {
    await expectPackError(resolvePack("ghost-pack"), "PACK_NOT_FOUND");
  });

  it("bare name absent from the registry → PACK_NOT_FOUND", async () => {
    const regDir = join(dir, "reg-empty");
    mkdirSync(regDir, { recursive: true });
    await expectPackError(
      resolvePack("absent", { registry: regDir }),
      "PACK_NOT_FOUND",
    );
  });
});
