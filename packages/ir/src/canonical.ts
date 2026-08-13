// Canonical JSON serialization — re-exported from @sverka/core.
// ADR-006 (amended): core is the single source of truth for canonicalStringify.
// The IR package re-exports it to avoid maintaining a duplicate implementation.

export { canonicalStringify } from "@sverka/core";
