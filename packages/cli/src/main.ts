import process from "node:process";
import yargs, { type Arguments, type Argv } from "yargs";
import { SdkError } from "@sverka/sdk";

import type { GlobalFlags, OutputWriter } from "./types.js";
import { CliError, ExitCode } from "./types.js";
import { createOutputWriter, wrapOutputWriter } from "./output.js";
import { initCommand } from "./commands/init.js";
import { inspectCommand } from "./commands/inspect.js";
import { planCommand } from "./commands/plan.js";
import { executeCommand } from "./commands/execute.js";
import { validateCommand } from "./commands/validate.js";
import { baselineCommand } from "./commands/baseline.js";
import { doctorCommand } from "./commands/doctor.js";

/** Optional dependencies for main (testability seam). */
export interface MainDeps {
  output?: OutputWriter;
}

/** Build GlobalFlags from parsed yargs options. */
function buildGlobalFlags(parsed: Arguments): GlobalFlags {
  return {
    format: parsed.format === "json" ? "json" : "human",
    config: typeof parsed.config === "string" ? parsed.config : null,
    root: typeof parsed.root === "string" ? parsed.root : process.cwd(),
    quiet: Boolean(parsed.quiet),
    verbose: Boolean(parsed.verbose),
  };
}

/** Resolve the real output writer, wrapping injected writers with flag semantics. */
function resolveOutputWriter(
  global: GlobalFlags,
  deps?: MainDeps,
): OutputWriter {
  if (deps?.output) {
    return wrapOutputWriter(global, deps.output);
  }
  return createOutputWriter(
    global,
    (s) => process.stdout.write(s),
    (s) => process.stderr.write(s),
  );
}

/** Configure the init subcommand options. */
function addInitCommand(y: Argv): Argv {
  return y.option("template", {
    type: "string",
    default: "minimal",
    choices: ["minimal", "full"],
  }).option("force", { type: "boolean", default: false });
}

/** Configure the execute/run subcommand options. */
function addExecuteCommand(y: Argv): Argv {
  return y
    .option("executor", {
      type: "string",
      default: "host",
      choices: ["host", "docker"],
    })
    .option("only-new", { type: "boolean", default: false })
    .option("baseline", { type: "string" });
}

/** Configure the baseline subcommand tree. */
function addBaselineCommand(y: Argv): Argv {
  return y
    .command("create", "Create a baseline from execution")
    .command("update", "Update the baseline")
    .command("show", "Display the baseline")
    .command("clear", "Remove the baseline file")
    .option("baseline", { type: "string" });
}

function buildParser(): Argv {
  return yargs([])
    .scriptName("sverka")
    .option("format", {
      type: "string",
      default: "human",
      alias: "f",
      choices: ["human", "json"],
    })
    .option("config", { type: "string", alias: "c" })
    .option("root", { type: "string", alias: "r", default: process.cwd() })
    .option("quiet", { type: "boolean", alias: "q", default: false })
    .option("verbose", { type: "boolean", alias: "v", default: false })
    .command("init", "Create a sverka.config.ts", addInitCommand)
    .command("inspect", "Discover and display project context")
    .command("plan", "Synthesize a plan without executing", (y) =>
      y.option("only-new", { type: "boolean", default: false }),
    )
    .command(["execute", "run"], "Execute the workflow locally", addExecuteCommand)
    .command("validate", "Validate a sverka.config.ts without executing")
    .command("baseline", "Manage the findings baseline", addBaselineCommand)
    .command("doctor", "Diagnose environment and dependencies")
    .demandCommand(1, "No command given")
    .strict()
    .fail((msg, err) => {
      if (err) throw err;
      throw new CliError(msg, "UNKNOWN_COMMAND", ExitCode.UsageError);
    });
}

/** Dispatch a single command to its handler. */
async function dispatch(
  command: string,
  parsed: Arguments,
  global: GlobalFlags,
  output: OutputWriter,
  start: number,
): Promise<number> {
  switch (command) {
    case "init":
      return dispatchInit(parsed, global, output, start);
    case "inspect":
      return inspectCommand(global, output, start);
    case "plan":
      return dispatchPlan(parsed, global, output, start);
    case "execute":
    case "run":
      return dispatchExecute(parsed, global, output, start);
    case "validate":
      return validateCommand(global, output, start);
    case "baseline":
      return dispatchBaseline(parsed, global, output, start);
    case "doctor":
      return doctorCommand(global, output, start);
    default:
      throw new CliError(
        `unknown command: ${command}`,
        "UNKNOWN_COMMAND",
        ExitCode.UsageError,
      );
  }
}

function dispatchInit(
  parsed: Arguments,
  global: GlobalFlags,
  output: OutputWriter,
  start: number,
): Promise<number> {
  return initCommand(
    {
      template: typeof parsed.template === "string" ? parsed.template : undefined,
      force: Boolean(parsed.force),
    },
    global,
    output,
    start,
  );
}

function dispatchPlan(
  parsed: Arguments,
  global: GlobalFlags,
  output: OutputWriter,
  start: number,
): Promise<number> {
  return planCommand(
    { onlyNew: Boolean(parsed["only-new"]) },
    global,
    output,
    start,
  );
}

function dispatchExecute(
  parsed: Arguments,
  global: GlobalFlags,
  output: OutputWriter,
  start: number,
): Promise<number> {
  return executeCommand(
    {
      executor: typeof parsed.executor === "string" ? parsed.executor : "host",
      onlyNew: Boolean(parsed["only-new"]),
      baseline: typeof parsed.baseline === "string" ? parsed.baseline : undefined,
    },
    global,
    output,
    start,
  );
}

function dispatchBaseline(
  parsed: Arguments,
  global: GlobalFlags,
  output: OutputWriter,
  start: number,
): Promise<number> {
  const sub = String(parsed._[1] ?? "");
  if (!sub) {
    throw new CliError(
      "baseline requires a subcommand (create, update, show, clear)",
      "MISSING_ARG",
      ExitCode.UsageError,
    );
  }
  return baselineCommand(
    { subcommand: sub, baselinePath: typeof parsed.baseline === "string" ? parsed.baseline : undefined },
    global,
    output,
    start,
  );
}

/**
 * The main CLI entry point.
 * @param argv Command-line arguments (excluding node and script path).
 * @returns Exit code (0 = success, 1 = policy fail, 2 = usage error, 3 = runtime error).
 */
export async function main(
  argv: string[],
  deps?: MainDeps,
): Promise<number> {
  const start = Date.now();

  // Output writer: injected (tests) or console (production).
  const output =
    deps?.output ??
    createOutputWriter(
      { format: "human", config: null, root: process.cwd(), quiet: false, verbose: false },
      (s) => process.stdout.write(s),
      (s) => process.stderr.write(s),
    );

  let parsed: Arguments;
  try {
    parsed = await buildParser().parseAsync(argv);
  } catch (e) {
    // yargs fail handler threw — convert to CliError.
    return handleError(e, output, start);
  }

  const global = buildGlobalFlags(parsed);
  const realOutput = resolveOutputWriter(global, deps);
  const command = String(parsed._[0] ?? "");

  realOutput.debug(`sverka: command=${command} root=${global.root} format=${global.format}`);

  try {
    return await dispatch(command, parsed, global, realOutput, start);
  } catch (e) {
    return handleError(e, realOutput, start);
  }
}

function handleError(
  e: unknown,
  output: OutputWriter,
  _start: number,
): number {
  if (e instanceof CliError) {
    output.errorLine(`error: ${e.message}`);
    return e.exitCode;
  }
  if (e instanceof SdkError) {
    output.errorLine(`error: ${e.message}`);
    return ExitCode.RuntimeError;
  }
  // Unknown error.
  const msg = e instanceof Error ? e.message : String(e);
  output.errorLine(`error: ${msg}`);
  return ExitCode.RuntimeError;
}
