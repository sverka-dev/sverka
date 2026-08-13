// Graph helpers used by CLI commands.
// Spec 17 — §30.

import type { DefinitionGraph } from "@sverka/core";

/**
 * Return the id of the first entry found across all pipelines.
 * Returns `undefined` when the graph contains no entries.
 */
export function resolveDefaultEntryId(graph: DefinitionGraph): string | undefined {
  for (const pipeline of graph.project.pipelines) {
    const entry = pipeline.entries[0];
    if (entry) return entry.id;
  }
  return undefined;
}
