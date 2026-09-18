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

export async function resolve(
  specifier: string,
  context: { parentURL?: string } & Record<string, unknown>,
  nextResolve: (
    specifier: string,
    context: unknown,
  ) => Promise<{ url: string }>,
): Promise<{ url: string }> {
  try {
    return await nextResolve(specifier, context);
  } catch (e) {
    if (!specifier.startsWith("@sverka/")) throw e;
    try {
      return await nextResolve(specifier, {
        ...context,
        parentURL: import.meta.url,
      });
    } catch {
      throw e;
    }
  }
}
