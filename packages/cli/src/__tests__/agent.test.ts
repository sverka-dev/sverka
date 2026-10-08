// Spec 54 — sverka agent: env-driven single agent invocation used by
// generated CI agent jobs. Covers prompt requirement, the in-job mention
// re-check, artifact emission, and the NO_AGENT_DRIVER contract.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { agentCommand } from "../commands/agent.js";
import { ExitCode } from "../types.js";
import {
  makeTempDir,
  cleanupTempDir,
  CaptureWriter,
} from "./helpers/fixtures.js";

const ENV_KEYS = [
  "SVERKA_AGENT_ENGINE",
  "SVERKA_AGENT_DRIVER",
  "SVERKA_AGENT_MODEL",
  "SVERKA_AGENT_PROMPT",
  "SVERKA_AGENT_MAX_TOKENS",
  "SVERKA_AGENT_ANTHROPIC_KEY",
  "SVERKA_AGENT_OPENAI_KEY",
  "GITLAB_DUO_TOKEN",
  "SVERKA_MENTION",
  "COMMENT_BODY",
] as const;

describe("sverka agent (Spec 54)", () => {
  let dir: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    dir = await makeTempDir();
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(async () => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    await cleanupTempDir(dir);
  });

  const global = () => ({
    root: dir,
    format: "text" as const,
    config: null,
    quiet: false,
    verbose: false,
  });

  it("fails when SVERKA_AGENT_PROMPT is not set", async () => {
    process.env.SVERKA_AGENT_DRIVER = "stub";
    await expect(
      agentCommand({}, global(), new CaptureWriter(), 0),
    ).rejects.toThrow(/SVERKA_AGENT_PROMPT is not set/);
  });

  it("stub driver runs and writes agent-result.json + sverka-writes.json", async () => {
    process.env.SVERKA_AGENT_DRIVER = "stub";
    process.env.SVERKA_AGENT_PROMPT = "Summarize the MR";
    const code = await agentCommand({}, global(), new CaptureWriter(), 0);
    expect(code).toBe(ExitCode.Success);
    const result = JSON.parse(
      await readFile(join(dir, "agent-result.json"), "utf-8"),
    ) as { text: string; finishReason: string };
    expect(result.finishReason).toBeDefined();
    const writes = JSON.parse(
      await readFile(join(dir, "sverka-writes.json"), "utf-8"),
    ) as { writes: unknown[] };
    expect(writes.writes).toEqual([]);
  });

  it("test 10: missing engine key fails NO_AGENT_DRIVER naming the env var", async () => {
    process.env.SVERKA_AGENT_ENGINE = "anthropic";
    process.env.SVERKA_AGENT_PROMPT = "x";
    await expect(
      agentCommand({}, global(), new CaptureWriter(), 0),
    ).rejects.toThrow(/NO_AGENT_DRIVER.*SVERKA_AGENT_ANTHROPIC_KEY/s);
  });

  it("mention re-check: comment without the mention skips the model call", async () => {
    process.env.SVERKA_AGENT_DRIVER = "stub";
    process.env.SVERKA_AGENT_PROMPT = "x";
    process.env.SVERKA_MENTION = "@sverka";
    process.env.COMMENT_BODY = "please review this";
    const out = new CaptureWriter();
    const code = await agentCommand({}, global(), out, 0);
    expect(code).toBe(ExitCode.Success);
    expect(out.stdoutText).toContain("does not contain mention");
  });

  it("mention re-check passes when the body contains the mention", async () => {
    process.env.SVERKA_AGENT_DRIVER = "stub";
    process.env.SVERKA_AGENT_PROMPT = "x";
    process.env.SVERKA_MENTION = "@sverka";
    process.env.COMMENT_BODY = "@sverka please review this";
    const code = await agentCommand({}, global(), new CaptureWriter(), 0);
    expect(code).toBe(ExitCode.Success);
  });
});
