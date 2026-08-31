// GHA action SHA pinning. Spec 22 — §19, §31.3, §26.
//
// Pins third-party `uses:` refs to immutable commit SHAs sourced from a
// bundled registry (no network access at compile time — §31.3). Pinned
// output embeds the original version as a comment for auditability:
// `actions/checkout@<sha> # v4`.

import bundledRegistry from "./pinned-actions.json" with { type: "json" };

/** Registry mapping `org/name@vN` refs to 40-char commit SHAs. */
export interface PinRegistry {
  readonly [ref: string]: string;
}

/** Pinning configuration for {@link GithubTarget}. */
export interface PinningConfig {
  /** `"strict"` pins known refs and errors on missing entries; `"off"` leaves refs unchanged. */
  readonly mode: "strict" | "off";
  /** Custom registry; defaults to the bundled `pinned-actions.json`. */
  readonly registry?: PinRegistry;
}

const SHA_RE = /^[0-9a-f]{40}$/;

/**
 * Pin a single `uses:` ref to its commit SHA.
 *
 * Rules (spec 22 §"Data models"):
 * 1. Local action (`./…`) → unchanged.
 * 2. Already pinned (`@<40 hex>`) → unchanged.
 * 3. `org/name@vN` in registry → `org/name@<sha> # vN`.
 * 4. `org/name@vN` not in registry → unchanged (caller emits a diagnostic).
 *
 * Refs without `@` (malformed) are returned unchanged.
 */
export function pinActionRef(ref: string, registry: PinRegistry): string {
  // Rule 1: local action.
  if (ref.startsWith("./")) return ref;

  const at = ref.lastIndexOf("@");
  if (at < 0) return ref; // malformed — no @

  const head = ref.slice(0, at);
  const tail = ref.slice(at + 1);

  // Rule 2: already pinned to a 40-hex SHA.
  if (SHA_RE.test(tail)) return ref;

  const sha = registry[ref];
  // Rule 4: not in registry — unchanged.
  if (!sha) return ref;

  // Rule 3: pin and embed the version as a comment.
  return `${head}@${sha} # ${tail}`;
}

/**
 * Load the bundled `pinned-actions.json` registry.
 */
export function loadBundledRegistry(): PinRegistry {
  return bundledRegistry as PinRegistry;
}
