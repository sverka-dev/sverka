// @sverka/compiler — public barrel

export * from "./compiler-github/index.js";
export * from "./compiler-gitlab/index.js";
export * from "./plugin/index.js";

// Spec 22: GHA action SHA pinning (re-exported from the native github target).
export { pinActionRef, loadBundledRegistry } from "./github/pinning.js";
export type { PinRegistry, PinningConfig } from "./github/pinning.js";
