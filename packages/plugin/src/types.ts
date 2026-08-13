// Plugin and capability types. Spec 07 — §17, §24, §26.

import type { DefinitionGraph } from "@sverka/core";

// ---------------------------------------------------------------------------
// Capability model (§24)
// ---------------------------------------------------------------------------

export type CapabilitySupport =
  | "native"
  | "lowered"
  | "emulated"
  | "connector"
  | "partial"
  | "unsupported";

export interface CapabilityDetail {
  readonly support: CapabilitySupport;
  readonly via?: string;
  readonly notes?: string;
}

export type CapabilityManifest = Record<string, CapabilitySupport | CapabilityDetail>;

export interface CapabilityDiagnostic {
  readonly capability: string;
  readonly support: CapabilitySupport;
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly stepId?: string;
}

// ---------------------------------------------------------------------------
// Plugin facets (§17.2)
// ---------------------------------------------------------------------------

export interface ModelContribution {
  readonly kind: string;
  readonly description?: string;
}

export interface GraphTransform {
  readonly name: string;
  transform(graph: DefinitionGraph): DefinitionGraph;
}

export interface GraphValidator {
  readonly name: string;
  validate(graph: DefinitionGraph): readonly CapabilityDiagnostic[];
}

export interface Target {
  readonly name: string;
  compile(graph: DefinitionGraph): CompilationResult;
}

export interface CompilationResult {
  readonly artifacts: readonly { readonly path: string; readonly content: string }[];
  readonly diagnostics: readonly CapabilityDiagnostic[];
}

export interface Importer {
  readonly name: string;
  parse(input: string): DefinitionGraph;
}

export interface Engine {
  readonly name: string;
  execute(plan: unknown): unknown;
}

export interface ConnectorFactory {
  readonly name: string;
  create(config: unknown): unknown;
}

export interface NativeExtension {
  readonly plugin: string;
  readonly schemaVersion: string;
  readonly capabilities: readonly string[];
  readonly fallback?: string;
}

// ---------------------------------------------------------------------------
// Plugin interface (§17.1)
// ---------------------------------------------------------------------------

export interface SverkaPlugin {
  readonly name: string;
  readonly apiVersion: string;
  readonly capabilities?: CapabilityManifest;
  readonly model?: readonly ModelContribution[];
  readonly transforms?: readonly GraphTransform[];
  readonly validators?: readonly GraphValidator[];
  readonly targets?: readonly Target[];
  readonly importers?: readonly Importer[];
  readonly engines?: readonly Engine[];
  readonly connectors?: readonly ConnectorFactory[];
  readonly extensions?: readonly NativeExtension[];
}

export interface PluginOptions {
  readonly [key: string]: unknown;
}

export interface PluginMeta {
  readonly version: string;
}

// ---------------------------------------------------------------------------
// Plugin registry
// ---------------------------------------------------------------------------

export interface PluginRegistry {
  register(plugin: SverkaPlugin): void;
  readonly plugins: readonly SverkaPlugin[];
  getCapabilities(): CapabilityManifest[];
}
