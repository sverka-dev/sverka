// Shared set of protected Proxy properties to avoid accidental access
// to Promise/JSON/inspection internals when using dynamic property proxies.

export const PROTECTED_PROXY_PROPS = new Set<string | symbol>([
  "then",
  "toJSON",
  "inspect",
  "constructor",
  "valueOf",
  Symbol.toPrimitive,
  Symbol.iterator,
  Symbol.toStringTag,
]);
