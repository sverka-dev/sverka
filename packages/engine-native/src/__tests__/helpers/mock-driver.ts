// Mock runtime driver for testing.
import type { StepDefinition } from "@sverka/core";
import type { RuntimeDriver, ShellExecuteRequest, ShellResult } from "../../types.js";

export interface MockDriverConfig {
  readonly name?: string;
  readonly canExecuteFn?: (step: StepDefinition) => boolean;
  readonly executeFn?: (request: ShellExecuteRequest) => Promise<ShellResult>;
  readonly delayMs?: number;
}

export function createMockDriver(config: MockDriverConfig = {}): RuntimeDriver {
  return {
    name: config.name ?? "mock",
    canExecute: config.canExecuteFn ?? (() => true),
    executeShell: config.executeFn ?? (async (req: ShellExecuteRequest): Promise<ShellResult> => {
      if (config.delayMs) {
        await new Promise((r) => setTimeout(r, config.delayMs));
      }
      // Simulate exit 1 for commands that start with "exit 1".
      if (req.command.trim().startsWith("exit 1")) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "mock: simulated failure",
          durationMs: 5,
          timedOut: false,
        };
      }
      return {
        exitCode: 0,
        stdout: `mock: ${req.command}`,
        stderr: "",
        durationMs: 10,
        timedOut: false,
      };
    }),
  };
}

/** A mock driver that simulates writing output files. */
export function createOutputWritingMockDriver(): RuntimeDriver {
  return {
    name: "mock-output",
    canExecute: () => true,
    executeShell: async (req): Promise<ShellResult> => {
      const { writeFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      // If the command contains "echo X > output/Y", write the file.
      const match = req.command.match(/echo\s+"?([^>"]+?)"?\s*>\s*\$SVERKA_OUTPUT_DIR\/(\S+)/);
      if (match) {
        const value = match[1]!.trim();
        const outputName = match[2]!;
        const outputDir = req.env.SVERKA_OUTPUT_DIR;
        if (outputDir) {
          await writeFile(join(outputDir, outputName), value);
        }
      }
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 5,
        timedOut: false,
      };
    },
  };
}
