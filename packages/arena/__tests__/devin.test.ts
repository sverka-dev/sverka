import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { Writable, Readable } from "node:stream";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import * as acp from "@agentclientprotocol/sdk";

import {
  DevinAdapter,
  installPlugins,
  transcriptDir,
  countLlmCalls,
  readSessionTranscript,
} from "../src/adapters/devin.js";
import type {
  AgentSpawnConfig,
  ModelConfig,
  PluginConfig,
} from "../src/types.js";

// ─── Mock child_process.spawn ────────────────────────────────────────
//
// We mock `spawn` so we can control the subprocess stdin/stdout and feed
// canned ACP JSON-RPC messages back to the adapter. This lets us test the
// full session flow without a real `devin` binary.

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

// Import the mocked spawn after vi.mock.
const { spawn: spawnMock } = await import("node:child_process");

/** A minimal mock ChildProcess with controllable stdin/stdout streams. */
function mockChild(): {
  child: unknown;
  stdin: Writable;
  stdout: Readable;
  emitLine: (line: string) => void;
  kill: () => void;
} {
  const stdin = new Writable({ write: () => {} });
  const stdout = new Readable({ read() {} });
  const emitter = new EventEmitter();
  let killed = false;
  const proc = {
    stdin,
    stdout,
    stderr: process.stderr,
    kill: (sig?: string) => {
      killed = true;
      emitter.emit("exit", 0, sig);
    },
    on: emitter.on.bind(emitter),
    once: emitter.once.bind(emitter),
    emit: emitter.emit.bind(emitter),
    pid: 12345,
    isKilled: () => killed,
  };
  return {
    child: proc,
    stdin,
    stdout,
    emitLine: (line: string) => stdout.push(Buffer.from(line + "\n")),
    kill: () => proc.kill("SIGTERM"),
  };
}

// ─── Fixtures ────────────────────────────────────────────────────────

const model: ModelConfig = {
  id: "glm-5-2",
  name: "GLM-5.2",
  envVar: "DEVIN_MODEL",
};

const plugin = (id: string, enabled: boolean): PluginConfig => ({
  id,
  name: id,
  path: "",
  enabled,
});

// ─── DevinAdapter construction ───────────────────────────────────────

describe("DevinAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("can be constructed with id 'devin'", () => {
    const adapter = new DevinAdapter();
    expect(adapter.id).toBe("devin");
  });

  it("spawn returns an AgentProcess with run and kill", () => {
    const mock = mockChild();
    vi.mocked(spawnMock).mockReturnValue(mock.child as never);

    const adapter = new DevinAdapter();
    const proc = adapter.spawn({
      model,
      workspace: "/tmp/ws",
      plugins: [],
    });

    expect(typeof proc.run).toBe("function");
    expect(typeof proc.kill).toBe("function");
  });

  it("spawns `devin acp --model <id>` with correct env", () => {
    const mock = mockChild();
    vi.mocked(spawnMock).mockReturnValue(mock.child as never);

    const adapter = new DevinAdapter();
    adapter.spawn({
      model,
      workspace: "/tmp/ws",
      plugins: [],
      permissionMode: "dangerous",
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const args = vi.mocked(spawnMock).mock.calls[0];
    expect(args?.[0]).toBe("devin");
    expect(args?.[1]).toEqual(["acp", "--model", "glm-5-2"]);
    const opts = args?.[2] as { cwd: string; env: Record<string, string> };
    expect(opts.cwd).toBe("/tmp/ws");
    expect(opts.env["DEVIN_PERMISSION_MODE"]).toBe("dangerous");
    expect(opts.env["DEVIN_MODEL"]).toBe("glm-5-2");
  });

  it("uses accept-edits permission mode when specified", () => {
    const mock = mockChild();
    vi.mocked(spawnMock).mockReturnValue(mock.child as never);

    const adapter = new DevinAdapter();
    adapter.spawn({
      model,
      workspace: "/tmp/ws",
      plugins: [],
      permissionMode: "accept-edits",
    });

    const opts = vi.mocked(spawnMock).mock.calls[0]?.[2] as {
      env: Record<string, string>;
    };
    expect(opts.env["DEVIN_PERMISSION_MODE"]).toBe("accept-edits");
  });

  /** Spawn the adapter and return the AgentProcess + the isolated env home dir. */
  function spawnWithEnvHome(adapter: DevinAdapter): {
    proc: ReturnType<DevinAdapter["spawn"]>;
    envHome: string;
  } {
    const proc = adapter.spawn({ model, workspace: "/tmp/ws", plugins: [] });
    const opts = vi.mocked(spawnMock).mock.calls.at(-1)?.[2] as {
      env: Record<string, string>;
    };
    return {
      proc,
      envHome: dirname(opts.env["XDG_CONFIG_HOME"] ?? ""),
    };
  }

  it("spawns in an isolated XDG env so host skills/plugins don't leak", () => {
    const mock = mockChild();
    vi.mocked(spawnMock).mockReturnValue(mock.child as never);

    const { envHome } = spawnWithEnvHome(new DevinAdapter());

    expect(envHome).toMatch(/arena-env-/);
    expect(envHome).not.toBe(dirname(process.env.XDG_CONFIG_HOME ?? ""));
    expect(envHome).not.toBe(dirname(process.env.XDG_DATA_HOME ?? ""));
  });

  it("kill removes the isolated env home", async () => {
    const mock = mockChild();
    vi.mocked(spawnMock).mockReturnValue(mock.child as never);

    const { proc, envHome } = spawnWithEnvHome(new DevinAdapter());
    expect(existsSync(envHome)).toBe(true);

    proc.kill();
    await vi.waitFor(() => expect(existsSync(envHome)).toBe(false));
  });

  it("run removes the isolated env home after the session", async () => {
    const mock = mockChild();
    vi.mocked(spawnMock).mockReturnValue(mock.child as never);

    const { proc, envHome } = spawnWithEnvHome(new DevinAdapter());
    mock.stdout.push(null);

    await proc.run("hello", 5000);
    await vi.waitFor(() => expect(existsSync(envHome)).toBe(false));
  });

  it("kill terminates the spawned process", () => {
    const mock = mockChild();
    vi.mocked(spawnMock).mockReturnValue(mock.child as never);

    const adapter = new DevinAdapter();
    const proc = adapter.spawn({
      model,
      workspace: "/tmp/ws",
      plugins: [],
    });

    proc.kill();
    expect((mock.child as { isKilled: () => boolean }).isKilled()).toBe(true);
  });

  it("run returns a RunResult with empty trace when session fails immediately", async () => {
    const mock = mockChild();
    vi.mocked(spawnMock).mockReturnValue(mock.child as never);

    const adapter = new DevinAdapter();
    const proc = adapter.spawn({
      model,
      workspace: "/tmp/ws",
      plugins: [],
    });

    // Close stdout immediately to simulate a failed/empty agent.
    mock.stdout.push(null);

    const result = await proc.run("hello", 5000);

    expect(result.modelId).toBe("glm-5-2");
    expect(result.success).toBe(false);
    expect(result.trace.steps).toEqual([]);
    expect(result.metrics.stopReason).toBe("cancelled");
  });
});

// ─── installPlugins ──────────────────────────────────────────────────

describe("installPlugins", () => {
  it("copies enabled plugins to .agents/skills/<id>/", async () => {
    const ws = await mkdtemp(join(tmpdir(), "arena-plugin-"));
    const srcDir = await mkdtemp(join(tmpdir(), "arena-src-"));
    await writeFile(join(srcDir, "SKILL.md"), "# Skill\n");

    const plugins: PluginConfig[] = [
      { id: "sverka", name: "Sverka", path: srcDir, enabled: true },
    ];

    await installPlugins(ws, plugins);

    const copied = await readFile(
      join(ws, ".agents", "skills", "sverka", "SKILL.md"),
      "utf-8",
    );
    expect(copied).toBe("# Skill\n");

    await rm(ws, { recursive: true, force: true });
    await rm(srcDir, { recursive: true, force: true });
  });

  it("removes disabled plugins from .agents/skills/<id>/", async () => {
    const ws = await mkdtemp(join(tmpdir(), "arena-plugin-"));
    const skillDir = join(ws, ".agents", "skills", "old");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "old");

    const plugins: PluginConfig[] = [
      { id: "old", name: "Old", path: "/tmp/old", enabled: false },
    ];

    await installPlugins(ws, plugins);

    // The directory should be removed.
    await expect(
      readFile(join(skillDir, "SKILL.md"), "utf-8"),
    ).rejects.toThrow();

    await rm(ws, { recursive: true, force: true });
  });

  it("handles a mix of enabled and disabled plugins", async () => {
    const ws = await mkdtemp(join(tmpdir(), "arena-plugin-"));
    const srcA = await mkdtemp(join(tmpdir(), "arena-src-a-"));
    await writeFile(join(srcA, "SKILL.md"), "# A\n");

    // Pre-create a disabled plugin dir to verify removal.
    const disabledDir = join(ws, ".agents", "skills", "disabled");
    await mkdir(disabledDir, { recursive: true });
    await writeFile(join(disabledDir, "SKILL.md"), "stale");

    const plugins: PluginConfig[] = [
      { id: "a", name: "A", path: srcA, enabled: true },
      {
        id: "disabled",
        name: "Disabled",
        path: "/tmp/disabled",
        enabled: false,
      },
    ];

    await installPlugins(ws, plugins);

    const aContent = await readFile(
      join(ws, ".agents", "skills", "a", "SKILL.md"),
      "utf-8",
    );
    expect(aContent).toBe("# A\n");
    await expect(
      readFile(join(disabledDir, "SKILL.md"), "utf-8"),
    ).rejects.toThrow();

    await rm(ws, { recursive: true, force: true });
    await rm(srcA, { recursive: true, force: true });
  });

  it("writes .devin/config.json with forbiddenPlugins ['*']", async () => {
    const ws = await mkdtemp(join(tmpdir(), "arena-plugin-"));

    await installPlugins(ws, []);

    const manifest = JSON.parse(
      await readFile(join(ws, ".devin", "config.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(manifest["forbiddenPlugins"]).toEqual(["*"]);

    await rm(ws, { recursive: true, force: true });
  });

  it("preserves existing keys when merging the forbid manifest", async () => {
    const ws = await mkdtemp(join(tmpdir(), "arena-plugin-"));
    await mkdir(join(ws, ".devin"), { recursive: true });
    await writeFile(
      join(ws, ".devin", "config.json"),
      JSON.stringify({ requiredPlugins: ["org-mandated"], model: "x" }),
    );

    await installPlugins(ws, []);

    const manifest = JSON.parse(
      await readFile(join(ws, ".devin", "config.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(manifest["forbiddenPlugins"]).toEqual(["*"]);
    expect(manifest["requiredPlugins"]).toEqual(["org-mandated"]);
    expect(manifest["model"]).toBe("x");

    await rm(ws, { recursive: true, force: true });
  });
});

// ─── transcriptDir + countLlmCalls ───────────────────────────────────

describe("transcriptDir", () => {
  it("returns ~/.local/share/devin/cli/transcripts", () => {
    const dir = transcriptDir();
    expect(dir).toContain(".local");
    expect(dir).toContain("devin");
    expect(dir).toContain("transcripts");
  });
});

describe("countLlmCalls", () => {
  it("counts agent steps with telemetry.operation === 'inference'", () => {
    const transcript = {
      session_id: "s1",
      schema_version: "1",
      agent: { name: "devin", version: "1", model_name: "glm-5-2" },
      final_metrics: {
        total_prompt_tokens: 0,
        total_completion_tokens: 0,
        total_cached_tokens: 0,
        total_steps: 4,
      },
      steps: [
        {
          step_id: 0,
          source: "user",
          message: "hi",
          timestamp: "t0",
          extra: null,
        },
        {
          step_id: 1,
          source: "agent",
          message: "thinking",
          timestamp: "t1",
          extra: { telemetry: { operation: "inference" } },
        },
        {
          step_id: 2,
          source: "agent",
          message: "acting",
          timestamp: "t2",
          extra: { telemetry: { operation: "tool" } },
        },
        {
          step_id: 3,
          source: "agent",
          message: "thinking2",
          timestamp: "t3",
          extra: { telemetry: { operation: "inference" } },
        },
      ],
    };
    expect(countLlmCalls(transcript)).toBe(2);
  });

  it("synthesizes a transcript from the session DB with per-call metrics", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const dir = await mkdtemp(join(tmpdir(), "arena-db-"));
    const dbPath = join(dir, "sessions.db");
    const db = new DatabaseSync(dbPath);
    db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, model TEXT);
             CREATE TABLE message_nodes (row_id INTEGER PRIMARY KEY,
               session_id TEXT NOT NULL, node_id INTEGER NOT NULL,
               parent_node_id INTEGER, chat_message TEXT NOT NULL,
               created_at INTEGER NOT NULL, metadata TEXT)`);
    db.prepare("INSERT INTO sessions (id, model) VALUES (?, ?)").run(
      "s1",
      "swe-2-medium",
    );
    const ins = db.prepare(
      "INSERT INTO message_nodes (session_id, node_id, chat_message, created_at) VALUES (?, ?, ?, ?)",
    );
    ins.run("s1", 0, JSON.stringify({ role: "user", content: "hi" }), 1000);
    ins.run(
      "s1",
      1,
      JSON.stringify({
        role: "assistant",
        content: "",
        thinking: { thinking: "let me look" },
        tool_calls: [{ id: "c1", name: "exec" }],
        metadata: {
          metrics: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_tokens: 10,
          },
        },
      }),
      2000,
    );
    ins.run(
      "s1",
      2,
      JSON.stringify({ role: "tool", content: "tool output" }),
      3000,
    );
    ins.run(
      "s1",
      3,
      JSON.stringify({
        role: "assistant",
        content: "done",
        metadata: {
          metrics: {
            input_tokens: 200,
            output_tokens: 20,
            cache_read_tokens: null,
          },
        },
      }),
      4000,
    );
    db.close();

    const t = readSessionTranscript("s1", dbPath);
    expect(t).toBeDefined();
    expect(t?.agent.model_name).toBe("swe-2-medium");
    // tool-role nodes are skipped — their content arrives via ACP observations
    expect(t?.steps).toHaveLength(3);
    expect(t?.steps[1]?.message).toBe("let me look");
    expect(countLlmCalls(t!)).toBe(2);
    expect(t?.final_metrics).toEqual({
      total_prompt_tokens: 300,
      total_completion_tokens: 70,
      total_cached_tokens: 10,
      total_steps: 2,
    });

    expect(readSessionTranscript("missing", dbPath)).toBeUndefined();
    await rm(dir, { recursive: true, force: true });
  });

  it("returns 0 when no agent inference steps exist", () => {
    const transcript = {
      session_id: "s1",
      schema_version: "1",
      agent: { name: "devin", version: "1", model_name: "glm-5-2" },
      final_metrics: {
        total_prompt_tokens: 0,
        total_completion_tokens: 0,
        total_cached_tokens: 0,
        total_steps: 1,
      },
      steps: [
        {
          step_id: 0,
          source: "user",
          message: "hi",
          timestamp: "t0",
          extra: null,
        },
      ],
    };
    expect(countLlmCalls(transcript)).toBe(0);
  });
});
