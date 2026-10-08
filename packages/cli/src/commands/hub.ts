// hub command — run the self-hosted remote run hub (Spec 55).
// `sverka hub serve --port 7357 --data ./.sverka-hub`

import type { GlobalFlags, OutputWriter } from "../types.js";
import { CliError, ExitCode } from "../types.js";
import { startHubServer } from "@sverka/hub";

export interface HubArgs {
  action?: string;
  port?: number;
  data?: string;
  host?: string;
}

export async function hubCommand(
  args: HubArgs,
  global: GlobalFlags,
  output: OutputWriter,
  _start: number,
): Promise<number> {
  if (args.action !== "serve") {
    throw new CliError(
      `unknown hub action "${args.action ?? ""}" (supported: serve)`,
      "UNKNOWN_COMMAND",
      ExitCode.UsageError,
    );
  }
  if (
    args.port !== undefined &&
    (!Number.isInteger(args.port) || args.port < 0 || args.port > 65535)
  ) {
    throw new CliError(
      "--port must be an integer in [0, 65535]",
      "INVALID_FLAG",
      ExitCode.UsageError,
    );
  }
  const dataDir = args.data ?? `${global.root}/.sverka-hub`;
  const server = await startHubServer({
    dataDir,
    ...(args.port !== undefined ? { port: args.port } : {}),
    ...(args.host !== undefined ? { host: args.host } : {}),
  });
  output.writeLine(`sverka hub listening on ${server.url}`);
  output.writeLine(`  data: ${server.dataDir}`);
  output.writeLine(`  dashboard: ${server.url}/`);
  output.writeLine("  (Ctrl+C to stop)");

  // Serve until interrupted — the process owns the lifecycle.
  await new Promise<void>((done) => {
    const stop = () => {
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
      done();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
  await server.close();
  return ExitCode.Success;
}
