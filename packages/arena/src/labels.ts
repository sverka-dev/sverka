/**
 * Labels for a plugin set — shared so a set renders the same way in the
 * report, the trace report, the judge comparison and the runner's combo
 * groups.
 */

/** The reserved label for a run with no plugins. */
export const NO_PLUGINS_LABEL = "no-plugins";

/**
 * Label for a plugin set.
 *
 * Every name is percent-encoded, so the separator only ever separates
 * names: `["a+b"]` renders `a%2Bb`, which is distinct from `["a","b"]` →
 * `a+b`. encodeURIComponent escapes both `+` and `,`, so a name can
 * never be mistaken for the separator. Names that need no escaping render
 * unchanged, so the common case is byte-identical to before.
 *
 * The empty set keeps the reserved `no-plugins` label; a plugin actually
 * named `no-plugins` still renders like the empty set (pre-existing, and
 * not worth a format change on its own).
 */
export function pluginSetLabel(
  pluginIds: readonly string[],
  separator = "+",
): string {
  if (pluginIds.length === 0) return NO_PLUGINS_LABEL;
  return pluginIds.map((id) => encodeName(id)).join(separator);
}

/**
 * Percent-encode a plugin name — never throws.
 *
 * `encodeURIComponent` raises a URIError on a lone UTF-16 surrogate, and
 * the plugin schema accepts any string: such a name must not abort the
 * report. The fallback encodes the code units by hand (a valid surrogate
 * pair keeps the standard encoding).
 */
function encodeName(name: string): string {
  try {
    return encodeURIComponent(name);
  } catch {
    let out = "";
    for (let i = 0; i < name.length; i++) {
      const unit = name.charCodeAt(i);
      if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < name.length) {
        const next = name.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          out += encodeURIComponent(name.slice(i, i + 2));
          i++;
          continue;
        }
      }
      out += `%${unit.toString(16).padStart(4, "0").toUpperCase()}`;
    }
    return out;
  }
}
