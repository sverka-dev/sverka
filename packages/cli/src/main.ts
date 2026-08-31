import process from "node:process";
import yargs, { type Arguments, type Argv } from "yargs";

import type { GlobalFlags, OutputWriter } from "./types.js";
import { CliError, ExitCode } from "./types.js";
import { createOutputWriter, wrapOutputWriter } from "./output.js";
import { initCommand } from "./commands/init.js";
import { validateCommand } from "./commands/validate.js";
import { planCommand, type PlanArgs } from "./commands/plan.js";
import { graphCommand } from "./commands/graph.js";
import { runCommand, type RunArgs } from "./commands/run.js";
import { discoverCommand } from "./commands/discover.js";
import { checkCommand } from "./commands/check.js";
import { policyCommand, type PolicyArgs } from "./commands/policy.js";
import { synthCommand, type SynthArgs } from "./commands/synth.js";
import { mcpServerCommand } from "./commands/mcp-server.js";
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

/** Configure the run subcommand options. */
function addRunCommand(y: Argv): Argv {
  return y
    .option("entry", { type: "string" })
    .option("executor", {
      type: "string",
      default: "host",
      choices: ["host", "docker"],
    });
}

/** Configure the plan subcommand options. */
function addPlanCommand(y: Argv): Argv {
  return y.option("entry", { type: "string" });
}

/** Configure the policy subcommand options. */
function addPolicyCommand(y: Argv): Argv {
  return y
    .option("findings", { type: "string", demandOption: true })
    .option("baseline", { type: "string" });
}

/** Configure the synth subcommand options. */
function addSynthCommand(y: Argv): Argv {
  return y.option("target", {
    type: "string",
    demandOption: true,
    choices: ["github", "gitlab"],
  });
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
    .command("validate", "Validate a sverka config")
    .command("plan", "Bind Entry + inputs → Run Plan", addPlanCommand)
    .command("graph", "Display the Definition Graph")
    .command("run", "Execute the workflow locally", addRunCommand)
    .command("discover", "Discover and display project context")
    .command("check", "Resolve proposed checks → StepDefinitions")
    .command("policy", "Evaluate findings against policy", addPolicyCommand)
    .command("synth", "Compile to a target (stub — requires Waves H/I)", addSynthCommand)
    .command("mcp-server", "Expose Sverka as an MCP server (stdio)")
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
    case "validate":
      return validateCommand(global, output, start);
    case "plan":
      return dispatchPlan(parsed, global, output, start);
    case "graph":
      return graphCommand(global, output, start);
    case "run":
      return dispatchRun(parsed, global, output, start);
    case "discover":
      return discoverCommand(global, output, start);
    case "check":
      return checkCommand(global, output, start);
    case "policy":
      return dispatchPolicy(parsed, global, output, start);
    case "synth":
      return dispatchSynth(parsed, global, output, start);
    case "mcp-server":
      return mcpServerCommand({}, global, output, start);
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
  const args: PlanArgs = {};
  if (typeof parsed.entry === "string") args.entryId = parsed.entry;
  return planCommand(args, global, output, start);
}

function dispatchRun(
  parsed: Arguments,
  global: GlobalFlags,
  output: OutputWriter,
  start: number,
): Promise<number> {
  const args: RunArgs = {
    executor: parsed.executor === "docker" ? "docker" : "host",
  };
  if (typeof parsed.entry === "string") args.entryId = parsed.entry;
  return runCommand(args, global, output, start);
}

function dispatchPolicy(
  parsed: Arguments,
  global: GlobalFlags,
  output: OutputWriter,
  start: number,
): Promise<number> {
  const args: PolicyArgs = { findings: String(parsed.findings) };
  if (typeof parsed.baseline === "string") args.baseline = parsed.baseline;
  return policyCommand(args, global, output, start);
}

function dispatchSynth(
  parsed: Arguments,
  global: GlobalFlags,
  output: OutputWriter,
  start: number,
): Promise<number> {
  const target = parsed.target === "gitlab" ? "gitlab" : "github";
  const args: SynthArgs = { target };
  return synthCommand(args, global, output, start);
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
  const msg = e instanceof Error ? e.message : String(e);
  output.errorLine(`error: ${msg}`);
  return ExitCode.RuntimeError;
}
