// Error-message helpers shared by the bin entry and the command dispatcher.

/**
 * When a workspace @sverka/* dependency resolves but its dist output is
 * missing (partial build, stale checkout), Node throws a raw
 * ERR_MODULE_NOT_FOUND that does not tell the user what to do. Detect that
 * case and return an actionable hint, or null for unrelated errors.
 */
export function missingBuildHint(e: unknown): string | null {
  const msg = e instanceof Error ? e.message : String(e);
  const code = (e as { code?: unknown }).code;
  const isModuleNotFound =
    code === "ERR_MODULE_NOT_FOUND" ||
    /Cannot find (?:module|package)/.test(msg);
  if (
    isModuleNotFound &&
    msg.includes("@sverka/") &&
    /[/\\]dist[/\\]/.test(msg)
  ) {
    return (
      "a @sverka/* dependency has no build output — " +
      "run `bun run build` in the sverka checkout and retry"
    );
  }
  return null;
}
