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

/**
 * Create a dynamic Proxy that delegates protected/symbol properties to
 * Reflect.get and calls `resolve(prop)` for everything else.
 *
 * This shared factory eliminates duplication between context namespace
 * proxies and image reference proxies.
 */
export function createDynamicProxy<T>(
  resolve: (prop: string) => T,
): Record<string, T> {
  return new Proxy({} as Record<string, T>, {
    get(target, prop: string | symbol): T | unknown {
      if (typeof prop === "symbol" || PROTECTED_PROXY_PROPS.has(prop)) {
        return Reflect.get(target, prop);
      }
      return resolve(prop);
    },
  });
}
