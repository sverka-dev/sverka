// agent command — job-level agent invocation emitted into generated CI
// YAML (Spec 54). `npx sverka agent` inside an agent job resolves the
// driver from SVERKA_AGENT_* env vars, executes the prompt, and writes
// `agent-result.json` + `sverka-writes.json` artifacts the `__apply` job
// consumes. Config lives entirely in the environment — no positional args.

import process from "node:process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AGENT_ENV,
  collectAgentWrites,
  noAgentDriverError,
  resolveAgentDrivers,
  resolveAgentEngine,
} from "@sverka/runtime";
import type { AgentExecuteRequest } from "@sverka/runtime";
import type { GlobalFlags, OutputWriter } from "../types.js";
import { CliError, ExitCode } from "../types.js";

export interface AgentArgs {
  /** Directory for agent-result.json + sverka-writes.json (default: root). */
  outputDir?: string;
}

const RESULT_FILE = "agent-result.json";
const WRITES_FILE = "sverka-writes.json";

export async function agentCommand(
  args: AgentArgs,
  global: GlobalFlags,
  output: OutputWriter,
  _start: number,
): Promise<number> {
  const env = process.env;
  const engine = resolveAgentEngine(env);

  const prompt = env[AGENT_ENV.prompt];
  if (prompt === undefined || prompt === "") {
    throw new CliError(
      `sverka agent: ${AGENT_ENV.prompt} is not set — the compiled agent job provides it`,
      "MISSING_ARG",
      ExitCode.UsageError,
    );
  }

  const outDir = args.outputDir ?? global.root;

  // Defense-in-depth mention re-check (Spec 54): when a comment trigger
  // declared a mention, the job re-verifies the note contains it before
  // invoking the model — rules are the primary filter, this guards
  // against misconfigured webhook variables reaching the agent anyway.
  const mention = env[AGENT_ENV.mention];
  const commentBody = env["COMMENT_BODY"];
  if (
    mention !== undefined &&
    commentBody !== undefined &&
    !commentBody.includes(mention)
  ) {
    output.writeLine(
      `sverka agent: comment does not contain mention '${mention}' — skipping`,
    );
    await writeArtifacts(outDir, {
      text: "",
      finishReason: "stop",
    });
    return ExitCode.Success;
  }

  const drivers = resolveAgentDrivers(env);
  const driver = drivers.find((d) => d.canExecute(engine));
  if (driver === undefined) {
    // Spec 54: NO_AGENT_DRIVER names the env var a fix requires.
    throw noAgentDriverError(engine, `sverka agent, engine '${engine}'`);
  }

  const model = env[AGENT_ENV.model];
  const maxTokens = env[AGENT_ENV.maxTokens];
  const request: AgentExecuteRequest = {
    engine,
    prompt,
    ...(model !== undefined ? { model } : {}),
    ...(maxTokens !== undefined
      ? { maxTokens: parseMaxTokens(maxTokens) }
      : {}),
  };

  output.debug(`sverka agent: engine=${engine} driver=${driver.name}`);
  const result = await driver.executeAgent(request);
  const writes = collectAgentWrites(result);
  await writeArtifacts(outDir, result, writes);

  if (result.text !== "") output.writeLine(result.text);
  if (result.finishReason === "error") {
    output.errorLine("sverka agent: agent finished with reason 'error'");
    return ExitCode.RuntimeError;
  }
  return ExitCode.Success;
}

function parseMaxTokens(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new CliError(
      `sverka agent: ${AGENT_ENV.maxTokens} must be a positive integer, got '${raw}'`,
      "INVALID_FLAG",
      ExitCode.UsageError,
    );
  }
  return n;
}

async function writeArtifacts(
  dir: string,
  result: { text: string; finishReason: string },
  writes: readonly unknown[] = [],
): Promise<void> {
  await writeFile(
    join(dir, RESULT_FILE),
    JSON.stringify(result, null, 2),
    "utf-8",
  );
  await writeFile(
    join(dir, WRITES_FILE),
    JSON.stringify({ writes }, null, 2),
    "utf-8",
  );
}
