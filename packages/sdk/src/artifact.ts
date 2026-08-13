// artifact() — output declaration factory for artifact outputs.
// Spec 03 — §12.2.

import type { OutputDeclaration } from "@sverka/constructs";

/** Create an artifact output declaration with the given path. */
export function artifact(path: string): OutputDeclaration {
  return { type: "artifact", path };
}
