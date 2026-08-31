// Plugin factory and registry. Spec 07 — §17.1.

import type { SverkaPlugin, PluginOptions, PluginMeta, PluginRegistry, CapabilityManifest } from "./types.js";
import { validateCapabilityManifest } from "./capabilities.js";
import { PluginError } from "./errors.js";

/**
 * Define a Sverka plugin. The factory function receives optional options
 * and meta, and returns a SverkaPlugin object.
 *
 * @example
 * const plugin = defineSverkaPlugin(() => ({
 *   name: "github",
 *   apiVersion: "sverka.dev/v1",
 *   capabilities: { "trigger.push": "native" },
 * }));
 */
export function defineSverkaPlugin(
  factory: (options?: PluginOptions, meta?: PluginMeta) => SverkaPlugin,
  options?: PluginOptions,
): SverkaPlugin {
  const meta: PluginMeta = { version: "1.0.0" };
  const plugin = factory(options, meta);
  validatePlugin(plugin);
  return snapshotPlugin(plugin);
}

/**
 * Store a validated, defensive copy of a plugin so callers cannot mutate
 * the registry's internal state after registration.
 */
function snapshotPlugin(plugin: SverkaPlugin): SverkaPlugin {
  const copy: Record<string, unknown> = {
    name: plugin.name,
    apiVersion: plugin.apiVersion,
  };
  if (plugin.capabilities) {
    copy.capabilities = snapshotCapabilityManifest(plugin.capabilities);
  }
  if (plugin.model) copy.model = [...plugin.model];
  if (plugin.transforms) copy.transforms = [...plugin.transforms];
  if (plugin.validators) copy.validators = [...plugin.validators];
  if (plugin.targets) copy.targets = [...plugin.targets];
  if (plugin.importers) copy.importers = [...plugin.importers];
  if (plugin.engines) copy.engines = [...plugin.engines];
  if (plugin.connectors) copy.connectors = [...plugin.connectors];
  if (plugin.extensions) copy.extensions = [...plugin.extensions];
  // Tools facet is a live runtime object (ToolProvider); shallow-copy the
  // reference so the registry snapshot preserves the facet without trying to
  // deep-clone stateful connections (Spec 23).
  if (plugin.tools) copy.tools = plugin.tools;
  return copy as unknown as SverkaPlugin;
}

function snapshotCapabilityManifest(manifest: CapabilityManifest): CapabilityManifest {
  const copy: CapabilityManifest = {};
  for (const [capability, value] of Object.entries(manifest)) {
    copy[capability] = typeof value === "string" ? value : { ...value };
  }
  return copy;
}

/**
 * Validate a plugin has required fields and a valid capabilities manifest.
 */
function validatePlugin(plugin: SverkaPlugin): void {
  if (!plugin || typeof plugin !== "object") {
    throw new PluginError("plugin must be an object", "INVALID_PLUGIN");
  }
  if (typeof plugin.name !== "string" || plugin.name.length === 0) {
    throw new PluginError("plugin must have a non-empty name", "INVALID_PLUGIN");
  }
  if (typeof plugin.apiVersion !== "string" || plugin.apiVersion.length === 0) {
    throw new PluginError("plugin must have an apiVersion", "INVALID_PLUGIN");
  }
  if (plugin.capabilities !== undefined) {
    validateCapabilityManifest(plugin.capabilities);
  }
}

/**
 * Create a plugin registry.
 */
export function createPluginRegistry(): PluginRegistry {
  const plugins: SverkaPlugin[] = [];
  const names = new Set<string>();

  return {
    register(plugin: SverkaPlugin): void {
      validatePlugin(plugin);
      if (names.has(plugin.name)) {
        throw new PluginError(
          `plugin '${plugin.name}' is already registered`,
          "DUPLICATE_PLUGIN",
        );
      }
      names.add(plugin.name);
      plugins.push(snapshotPlugin(plugin));
    },
    get plugins(): readonly SverkaPlugin[] {
      return plugins.map((p) => snapshotPlugin(p));
    },
    getCapabilities(): CapabilityManifest[] {
      return plugins
        .filter((p) => p.capabilities !== undefined)
        .map((p) => snapshotCapabilityManifest(p.capabilities as CapabilityManifest));
    },
  };
}
