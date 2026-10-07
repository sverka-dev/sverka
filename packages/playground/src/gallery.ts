// @sverka/playground — examples gallery (Spec 53).
// `examples/*/` mini-projects are bundled at build time by the vite entry
// (app.ts collects them via import.meta.glob) — the picker needs no
// network access. This module stays bundler-agnostic so the library
// build (tsdown) never sees vite-only APIs.

export interface GalleryExample {
  /** Directory name, e.g. "failing-checks". */
  readonly id: string;
  /** Humanized label for the picker. */
  readonly title: string;
  /** sverka.config.ts source, bundled into the playground build. */
  readonly code: string;
}

function titleize(id: string): string {
  return id
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Turn a `{ "<path>/examples/<id>/sverka.config.ts": source }` map into a
 *  sorted picker list. */
export function listExamples(
  modules: Record<string, string>,
): readonly GalleryExample[] {
  return Object.entries(modules)
    .map(([path, code]) => {
      const id =
        /examples\/([^/]+)\/sverka\.config\.ts$/.exec(path)?.[1] ?? path;
      return { id, title: titleize(id), code };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}
