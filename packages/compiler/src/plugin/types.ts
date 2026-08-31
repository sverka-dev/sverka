// Plugin and capability types. Spec 07 — §17, §24, §26.

import type { DefinitionGraph } from "@sverka/workflow";

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
// Tools facet (§17.2 — Spec 23: MCP plugin transport)
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  /** Globally unique within plugin: "<server>.<tool>". */
  readonly name: string;
  readonly description?: string;
  /** JSON Schema describing accepted arguments. */
  readonly inputSchema?: Readonly<Record<string, unknown>>;
}

export type ToolResultContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string }
  | {
      readonly type: "resource";
      readonly resource: { readonly uri: string; readonly mimeType?: string };
    };

export interface ToolResult {
  readonly content: readonly ToolResultContent[];
  readonly isError?: boolean;
}

/**
 * Runtime facet for listing and calling tools. Added by Spec 23 to enable
 * MCP plugin transport; consumed by AgentStep (sv-wthn.2.2). Tools are
 * called at runtime, not synthesized into the Definition Graph.
 */
export interface ToolProvider {
  listTools(): Promise<readonly ToolDefinition[]>;
  callTool(
    name: string,
    args?: Readonly<Record<string, unknown>>,
  ): Promise<ToolResult>;
  dispose?(): Promise<void>;
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
  /** Tools facet (Spec 23): runtime tool listing/calling (e.g. MCP). */
  readonly tools?: ToolProvider;
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
