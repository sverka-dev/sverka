// ESM resolve hook for config loading.
//
// A globally-installed `sverka` binary must be able to load a project's
// sverka.config.ts even when that project has no local @sverka/* packages
// installed — Node resolves specifiers relative to the importing file, so
// the CLI's own bundled copies are invisible to the config's imports.
// When normal resolution fails for an @sverka/* specifier, we re-resolve it
// with parentURL pointing at this file — i.e. from the CLI's install root.
// Re-resolving through the standard resolver keeps package exports intact,
// so subpath imports (e.g. "@sverka/sdk/planner") work the same way.

type ResolveContext = { parentURL?: string } & Record<string, unknown>;
type ResolveResult = { url: string };
type NextResolve = (
  specifier: string,
  context: ResolveContext,
) => ResolveResult | Promise<ResolveResult>;

// nextResolve is synchronous under module.registerHooks (in-thread hooks)
// but returns a rejecting Promise under the deprecated module.register
// (worker hooks) — handle both so the @sverka/* fallback fires either way.
function onResolveFailure(
  specifier: string,
  context: ResolveContext,
  nextResolve: NextResolve,
  error: unknown,
): ResolveResult | Promise<ResolveResult> {
  if (!specifier.startsWith("@sverka/")) throw error;
  try {
    const fallback = nextResolve(specifier, {
      ...context,
      parentURL: import.meta.url,
    });
    if (fallback instanceof Promise) {
      return fallback.catch(() => {
        throw error;
      });
    }
    return fallback;
  } catch {
    throw error;
  }
}

export function resolve(
  specifier: string,
  context: ResolveContext,
  nextResolve: NextResolve,
): ResolveResult | Promise<ResolveResult> {
  let result: ResolveResult | Promise<ResolveResult>;
  try {
    result = nextResolve(specifier, context);
  } catch (e) {
    return onResolveFailure(specifier, context, nextResolve, e);
  }
  if (result instanceof Promise) {
    return result.catch((e) =>
      onResolveFailure(specifier, context, nextResolve, e),
    );
  }
  return result;
}
