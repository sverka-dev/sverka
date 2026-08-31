// Shared step reference helpers.

/** Extract the pipeline prefix from a fully qualified step id. */
export function stepPrefix(stepId: string): string {
  const idx = stepId.lastIndexOf("/");
  return idx === -1 ? "" : stepId.slice(0, idx);
}

/** Resolve a relative step reference against a pipeline prefix. */
export function resolveProducerId(prefix: string, from: string): string {
  if (from.includes("/")) return from;
  return prefix ? `${prefix}/${from}` : from;
}
