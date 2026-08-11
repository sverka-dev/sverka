/**
 * Canonical JSON serialization — re-exported from `@sverka/core`.
 *
 * The canonical JSON primitive is defined once in `@sverka/core` (per ADR-006)
 * and shared here to avoid duplication. Both `serializePlan` and
 * `computePlanId` use this single implementation, guaranteeing that the wire
 * format and the hash input can never drift from `computeOperationId`.
 */
export { canonicalStringify } from "@sverka/core";
