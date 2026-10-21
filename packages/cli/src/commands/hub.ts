// hub command — run the self-hosted remote run hub (Spec 55).
// `sverka hub serve --port 7357 --data ./.sverka-hub`

import type { GlobalFlags, OutputWriter } from "../types.js";
import { CliError, ExitCode } from "../types.js";
// Type-only import — erased at runtime, so it costs no dependency. The
// runtime import below is the dynamic one.
import type * as HubModule from "@sverka/hub";

export interface HubArgs {
  action?: string;
  port?: number;
  data?: string;
  host?: string;
}

/** Import the hub package — the seam the tests drive. */
export type HubLoader = () => Promise<typeof HubModule>;

/** Node's "module not found" codes — only these mean "not installed". */
const MODULE_NOT_FOUND: Record<string, true> = {
  MODULE_NOT_FOUND: true,
  ERR_MODULE_NOT_FOUND: true,
};

/**
 * Load the hub package on demand.
 *
 * A static import cannot work here: `@sverka/hub` is an optional
 * dependency (its name is not on npm yet), so in a plain `npm i sverka`
 * the module is absent and a static import would turn a missing feature
 * into a startup crash.
 *
 * Only a "module not found" failure means "not installed" — an error
 * raised *inside* the package is rethrown unchanged, so a broken install
 * is not reported as a missing one.
 */
export async function loadHub(
  load: HubLoader = () => import("@sverka/hub"),
): Promise<typeof HubModule> {
  try {
    return await load();
  } catch (e) {
    const code =
      typeof e === "object" && e !== null && "code" in e ? e.code : undefined;
    if (typeof code !== "string" || MODULE_NOT_FOUND[code] !== true) {
      throw e;
    }
    throw new CliError(
      "sverka hub: the @sverka/hub package is not installed — npm i @sverka/hub",
      "PACKAGE_ERROR",
      ExitCode.RuntimeError,
      e,
    );
  }
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
  const { startHubServer } = await loadHub();
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
