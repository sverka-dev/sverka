// ESM resolve hooks for config loading.
//
// A globally-installed `sverka` binary must be able to load a project's
// sverka.config.ts even when that project has no local @sverka/* packages
// installed — Node resolves bare specifiers relative to the importing file,
// so the CLI's own bundled copies are invisible to the config's imports.
// These hooks are registered once (module.register) before the config is
// imported and redirect unresolved @sverka/* specifiers to the copies that
// ship with the CLI.
//
// Fallback URLs are computed on the main thread and passed via register()
// data, which arrives here in `initialize`.

let fallbacks: Record<string, string> = {};

export async function initialize(data: unknown): Promise<void> {
  const map = (data as { fallbacks?: Record<string, string> } | undefined)
    ?.fallbacks;
  fallbacks = map ?? {};
}

export async function resolve(
  specifier: string,
  context: unknown,
  nextResolve: (
    specifier: string,
    context: unknown,
  ) => Promise<{ url: string }>,
): Promise<{ url: string; shortCircuit?: boolean }> {
  try {
    return await nextResolve(specifier, context);
  } catch (e) {
    const fallback = fallbacks[specifier];
    if (fallback !== undefined) {
      return { url: fallback, shortCircuit: true };
    }
    throw e;
  }
}
