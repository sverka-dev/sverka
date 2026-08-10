import { execSync } from "node:child_process";
import type { GlobalFlags, OutputWriter } from "../types.js";
import { ExitCode } from "../types.js";

interface DoctorCheck {
  name: string;
  status: "ok" | "missing";
  version: string | null;
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
    runCheck("node", "node"),
    runCheck("bun", "bun"),
    runCheck("git", "git"),
  ];

  const allOk = checks.every((c) => c.status === "ok");
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

function runCheck(name: string, binary: string): DoctorCheck {
  try {
    const out = execSync(`${binary} --version`, {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    // Strip leading 'v' from version strings (node v22.0.0 -> 22.0.0).
    const version = out.replace(/^v/, "");
    return { name, status: "ok", version };
  } catch {
    return { name, status: "missing", version: null };
  }
}
