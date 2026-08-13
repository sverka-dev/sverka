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
 * Matching rule: an entry matches a command if:
 * (a) the entry is an absolute path and equals the command exactly, or
 * (b) the entry is a bare name and equals the command's basename.
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
          // Match exact path OR basename of the entry against the command.
          return entry === command || basename(entry) === command || basename(entry) === cmdBasename;
        }
        return entry === command || entry === cmdBasename;
      });
    },
  };
}
