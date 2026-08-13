import { basename, isAbsolute } from "node:path";

/**
 * An allowlist of commands the host executor may run. Entries are binary
 * names (resolved via PATH) or absolute paths. Glob patterns are not
 * supported to keep matching deterministic.
 */
export interface CommandAllowlist {
  readonly entries: readonly string[];
  /** Returns true if the given command is allowed. */
  isAllowed(command: string): boolean;
}

/**
 * Create a command allowlist from a list of entries.
 *
 * Matching rule:
 * - Bare-name entries match the command exactly or its basename.
 * - Absolute-path entries match only the exact path.
 *
 * No globs. No partial matches. Empty list → nothing allowed.
 */
export function createAllowlist(entries: readonly string[]): CommandAllowlist {
  const normalized = [...entries];
  return {
    entries: normalized,
    isAllowed(command: string): boolean {
      if (!command) return false;
      const cmdBasename = basename(command);
      return normalized.some((entry) => {
        if (isAbsolute(entry)) {
          return entry === command;
        }
        return entry === command || entry === cmdBasename;
      });
    },
  };
}
