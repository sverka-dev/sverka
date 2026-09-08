// @sverka/reporter — DAG layout (pure). Spec 44.

import type { DefinitionGraph } from "@sverka/workflow";
import type { DagNode, DagEdge, DagLayoutResult, DagLayoutOptions } from "./types.js";

const DEFAULT_SPACING_X = 200;
const DEFAULT_SPACING_Y = 80;

/**
 * Compute a topological layer-based layout for a DefinitionGraph.
 * Pure: no side effects, deterministic output for the same input.
 */
export function layoutDag(
  graph: DefinitionGraph,
  options?: DagLayoutOptions,
): DagLayoutResult {
  const spacingX = options?.nodeSpacingX ?? DEFAULT_SPACING_X;
  const spacingY = options?.nodeSpacingY ?? DEFAULT_SPACING_Y;

  // Collect all steps from all pipelines.
  const steps = graph.project.pipelines.flatMap((p) => p.steps);
  const stepIds = new Set(steps.map((s) => s.id));

  // Build edges from dependencies.
  const edges: DagEdge[] = [];
  for (const step of steps) {
    for (const dep of step.dependencies) {
      // Only add edges for producers that exist in the graph.
      if (stepIds.has(dep.producer)) {
        edges.push({
          source: dep.producer,
          target: step.id,
          label: dep.kind,
        });
      }
    }
  }

  // Compute in-degree (number of incoming edges per node).
  const inDegree = new Map<string, number>();
  for (const id of stepIds) inDegree.set(id, 0);
  for (const edge of edges) {
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  // Layer assignment via longest path from roots.
  // layer[node] = max(layer[predecessor] + 1) for all predecessors, or 0 if root.
  const layer = new Map<string, number>();
  for (const id of stepIds) layer.set(id, 0);

  // Topological sort (Kahn's algorithm) to process nodes in dependency order.
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }
  queue.sort(); // deterministic order

  const adjList = new Map<string, string[]>();
  for (const id of stepIds) adjList.set(id, []);
  for (const edge of edges) {
    adjList.get(edge.source)?.push(edge.target);
  }

  const processed = new Set<string>();
  while (queue.length > 0) {
    const node = queue.shift()!;
    processed.add(node);
    const currentLayer = layer.get(node) ?? 0;
    for (const neighbor of adjList.get(node) ?? []) {
      // Update layer: longest path
      const neighborLayer = layer.get(neighbor) ?? 0;
      if (currentLayer + 1 > neighborLayer) {
        layer.set(neighbor, currentLayer + 1);
      }
      // Decrement in-degree
      const deg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, deg);
      if (deg === 0 && !processed.has(neighbor)) {
        queue.push(neighbor);
        queue.sort(); // keep deterministic
      }
    }
  }

  // Handle any remaining nodes (cycles or unprocessed) — assign layer 0.
  for (const id of stepIds) {
    if (!layer.has(id)) layer.set(id, 0);
  }

  // Group nodes by layer, sorted alphabetically within each layer.
  const byLayer = new Map<number, string[]>();
  for (const [id, l] of layer) {
    let group = byLayer.get(l);
    if (!group) {
      group = [];
      byLayer.set(l, group);
    }
    group.push(id);
  }
  for (const group of byLayer.values()) {
    group.sort();
  }

  // Assign positions.
  const nodes: DagNode[] = [];
  for (const [l, ids] of byLayer) {
    ids.forEach((id, index) => {
      nodes.push({
        id,
        label: id,
        x: l * spacingX,
        y: index * spacingY,
        layer: l,
      });
    });
  }

  // Sort nodes by layer then y for deterministic output.
  nodes.sort((a, b) => a.layer - b.layer || a.y - b.y || a.id.localeCompare(b.id));

  return { nodes, edges };
}
