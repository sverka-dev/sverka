// @sverka/plugin — public API. Spec 07.

export { defineSverkaPlugin, createPluginRegistry } from "./factory.js";
export { analyzeCapabilities, detectCapabilities } from "./capabilities.js";
export type {
  SverkaPlugin,
  PluginOptions,
  PluginMeta,
  PluginRegistry,
  CapabilityManifest,
  CapabilitySupport,
  CapabilityDetail,
  CapabilityDiagnostic,
  ModelContribution,
  GraphTransform,
  GraphValidator,
  Target,
  CompilationResult,
  Importer,
  Engine,
  ConnectorFactory,
  NativeExtension,
} from "./types.js";
export { PluginError, type PluginErrorCode } from "./errors.js";
