// Compatibility re-exports — delegate to the canonical implementation.
// This file exists to preserve the import path `@sverka/sdk/compat/sverka`
// for downstream consumers during the v0 migration.

export { createSverka, plan, toPlan, execute } from "../sverka.js";
