import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defineConfig,
  loadArenaConfig,
  resolveAdapter,
  ArenaError,
} from "../src/config.js";

describe("defineConfig", () => {
  it("returns the config unchanged (type helper)", () => {
    const cfg = defineConfig({
      agent: "devin",
      models: [{ id: "m1", name: "Model 1" }],
      tasks: [{ id: "t1", name: "Task 1", prompt: "do it" }],
      outputDir: ".arena",
    });
    expect(cfg.agent).toBe("devin");
    expect(cfg.tasks).toHaveLength(1);
  });
});

describe("resolveAdapter", () => {
  it("resolves the devin adapter by name", () => {
    expect(resolveAdapter("devin").id).toBe("devin");
  });

  it("throws ArenaError for unknown adapters", () => {
    expect(() => resolveAdapter("nope")).toThrow(ArenaError);
    expect(() => resolveAdapter("nope")).toThrow(/devin/);
  });
});

describe("loadArenaConfig", () => {
  const dir = mkdtempSync(join(tmpdir(), "arena-cfg-"));

  it("loads a valid arena.config.ts", async () => {
    writeFileSync(
      join(dir, "good.config.ts"),
      `export default {
        agent: "devin",
        models: [{ id: "m1", name: "Model 1" }],
        plugins: [{ id: "sverka", name: "Sverka", path: "plugins/sverka" }],
        tasks: [{ id: "t1", name: "Task", prompt: "p" }],
        outputDir: ".arena",
      };`,
    );
    const cfg = await loadArenaConfig(join(dir, "good.config.ts"));
    expect(cfg.agent.id).toBe("devin");
    expect(cfg.models[0]?.id).toBe("m1");
    expect(cfg.outputDir).toBe(".arena");
    expect(cfg.plugins[0]?.id).toBe("sverka");
  });

  it("wires judge agent from the same registry", async () => {
    writeFileSync(
      join(dir, "judge.config.ts"),
      `export default {
        agent: "devin",
        models: [{ id: "m1", name: "M" }],
        tasks: [{ id: "t1", name: "T", prompt: "p" }],
        outputDir: ".arena",
        judge: { model: { id: "j1", name: "Judge" }, repetitions: 2 },
      };`,
    );
    const cfg = await loadArenaConfig(join(dir, "judge.config.ts"));
    expect(cfg.judge?.model.id).toBe("j1");
    expect(cfg.judge?.agent.id).toBe("devin");
    expect(cfg.judge?.repetitions).toBe(2);
  });

  it("rejects unknown agent names", async () => {
    writeFileSync(
      join(dir, "bad-agent.config.ts"),
      `export default {
        agent: "not-an-agent",
        models: [{ id: "m1", name: "M" }],
        tasks: [{ id: "t1", name: "T", prompt: "p" }],
        outputDir: ".arena",
      };`,
    );
    await expect(
      loadArenaConfig(join(dir, "bad-agent.config.ts")),
    ).rejects.toThrow(/unknown agent/i);
  });

  it("rejects configs missing required fields", async () => {
    writeFileSync(
      join(dir, "invalid.config.ts"),
      `export default { agent: "devin" };`,
    );
    await expect(
      loadArenaConfig(join(dir, "invalid.config.ts")),
    ).rejects.toThrow(ArenaError);
  });

  it("throws ArenaError when the file does not exist", async () => {
    await expect(
      loadArenaConfig(join(dir, "missing.config.ts")),
    ).rejects.toThrow(ArenaError);
  });

  it("rejects configs without a default export object", async () => {
    writeFileSync(join(dir, "nodefault.config.ts"), `export const x = 42;`);
    await expect(
      loadArenaConfig(join(dir, "nodefault.config.ts")),
    ).rejects.toThrow(ArenaError);
  });
});
