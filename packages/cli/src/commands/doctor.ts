import { spawnSync } from "node:child_process";
import type { GlobalFlags, OutputWriter } from "../types.js";
import { ExitCode } from "../types.js";

interface DoctorCheck {
  name: string;
  status: "ok" | "missing";
  version: string | null;
  required: boolean;
}

/**
 * Check the environment: Node.js, Bun, git. Reports status of each.
 * Exit 0 when all pass, 3 when a required tool is missing.
 */
export async function doctorCommand(
  global: GlobalFlags,
  output: OutputWriter,
  start: number,
): Promise<number> {
  output.debug(`doctor: root=${global.root}`);
  const checks: DoctorCheck[] = [
    runCheck("node", "node", true),
    runCheck("bun", "bun", false),
    runCheck("git", "git", true),
  ];

  const allOk = checks.every((c) => !c.required || c.status === "ok");
  const exitCode = allOk ? ExitCode.Success : ExitCode.RuntimeError;

  const durationMs = Date.now() - start;
  if (global.format === "json") {
    output.writeLine(
      JSON.stringify({
        command: "doctor",
        data: { checks, allOk },
        durationMs,
      }),
    );
  } else {
    output.writeLine("Environment diagnostics:");
    for (const check of checks) {
      const version = check.version ? `v${check.version}` : "NOT FOUND";
      output.writeLine(`  ${check.name}: ${version}`);
    }
    output.writeLine(allOk ? "All checks passed." : "Some checks failed.");
  }

  return exitCode;
}

function runCheck(
  name: string,
  binary: string,
  required: boolean,
): DoctorCheck {
  try {
    const result = spawnSync(binary, ["--version"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
      // Bound the check so a hung shim (broken PATH entry, blocking prompt,
      // etc.) cannot hang the CLI indefinitely. A timeout throws and is
      // treated the same as a missing tool.
      timeout: 5000,
    });
    if (result.status !== 0 || result.error) {
      return { name, status: "missing", version: null, required };
    }
    const out = result.stdout.trim();
    // Extract the first x.y.z version token so output like "git version 2.43.0"
    // or "node v22.0.0" is normalized to "2.43.0" / "22.0.0".
    const match = out.match(/(\d+\.\d+\.\d+[^\s]*)/);
    const version = match?.[1] ?? out;
    return { name, status: "ok", version, required };
  } catch {
    return { name, status: "missing", version: null, required };
  }
}
