// Shared lowering helper for exportStdout operations.
// Both the GitHub and GitLab lowers bind a `fromStdout` artifact output to
// the most recent shell op's captured stdout.

/**
 * Quote a literal string using single quotes for a POSIX shell.
 */
export function shellQuoteSingle(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Wrap a shell command line so its stdout is also written to the declared
 * artifact file(s), matching the runtime's exportStdout semantics. The
 * capture must work under POSIX sh (no pipefail), so the command's stdout is
 * redirected to the file and replayed with cat; the original exit code is
 * re-raised so a failing check still fails the job.
 *
 * Background commands (`cmd &`) detach before stdout can be captured; the
 * runtime records an empty artifact for them, so empty files are created.
 */
export function wrapStdoutCaptureLine(
  command: string,
  names: readonly string[],
): string {
  const quoted = names.map(shellQuoteSingle);
  if (command.endsWith(" &")) {
    return [command, `touch ${quoted.join(" ")}`].join("\n");
  }
  const [first, ...rest] = quoted;
  const teeRest = rest.length > 0 ? ` | tee ${rest.join(" ")}` : "";
  return [
    "sverka_rc=0",
    `{ ${command}`,
    `} > ${first} || sverka_rc=$?`,
    `cat ${first}${teeRest}`,
    `if [ "$sverka_rc" -gt 0 ]; then exit "$sverka_rc"; fi`,
  ].join("\n");
}
