// @sverka/reporter — DAG layout (pure). Spec 44.

import type { DefinitionGraph } from "@sverka/workflow";
import type { DagNode, DagEdge, DagLayoutResult, DagLayoutOptions } from "./types.js";

const DEFAULT_SPACING_X = 200;
const DEFAULT_SPACING_Y = 80;

/** Collect all steps and build edges from dependencies. */
function buildEdges(graph: DefinitionGraph): { steps: readonly { id: string; dependencies: readonly { producer: string; kind?: string }[] }[]; stepIds: Set<string>; edges: DagEdge[] } {
  const steps = graph.project.pipelines.flatMap((p) => p.steps);
  const stepIds = new Set(steps.map((s) => s.id));
  const edges: DagEdge[] = [];
  for (const step of steps) {
    for (const dep of step.dependencies) {
      if (stepIds.has(dep.producer)) {
        edges.push({ source: dep.producer, target: step.id, label: dep.kind });
      }
    }
  }
  return { steps, stepIds, edges };
}

/** Compute in-degree for each node. */
function computeInDegrees(stepIds: Set<string>, edges: readonly DagEdge[]): Map<string, number> {
  const inDegree = new Map<string, number>();
  for (const id of stepIds) inDegree.set(id, 0);
  for (const edge of edges) {
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }
  return inDegree;
}

/** Build adjacency list from edges. */
function buildAdjList(stepIds: Set<string>, edges: readonly DagEdge[]): Map<string, string[]> {
  const adjList = new Map<string, string[]>();
  for (const id of stepIds) adjList.set(id, []);
  for (const edge of edges) {
    adjList.get(edge.source)?.push(edge.target);
  }
  return adjList;
}

/** Process a single neighbor: update layer and in-degree, enqueue if ready. */
function processNeighbor(
  neighbor: string,
  currentLayer: number,
  layer: Map<string, number>,
  inDegree: Map<string, number>,
  processed: Set<string>,
  queue: string[],
): void {
  const neighborLayer = layer.get(neighbor) ?? 0;
  if (currentLayer + 1 > neighborLayer) {
    layer.set(neighbor, currentLayer + 1);
  }
  const deg = (inDegree.get(neighbor) ?? 1) - 1;
  inDegree.set(neighbor, deg);
  if (deg === 0 && !processed.has(neighbor)) {
    queue.push(neighbor);
    queue.sort((a, b) => a.localeCompare(b));
  }
}

/** Assign layers via longest path from roots using Kahn's algorithm. */
function computeLayers(
  stepIds: Set<string>,
  inDegree: Map<string, number>,
  adjList: Map<string, string[]>,
): Map<string, number> {
  const layer = new Map<string, number>();
  for (const id of stepIds) layer.set(id, 0);

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }
  queue.sort((a, b) => a.localeCompare(b));

  const processed = new Set<string>();
  while (queue.length > 0) {
    const node = queue.shift()!;
    processed.add(node);
    const currentLayer = layer.get(node) ?? 0;
    for (const neighbor of adjList.get(node) ?? []) {
      processNeighbor(neighbor, currentLayer, layer, inDegree, processed, queue);
    }
  }

  for (const id of stepIds) {
    if (!layer.has(id)) layer.set(id, 0);
  }
  return layer;
}

/** Group node ids by layer, sorted alphabetically. */
function groupByLayer(layer: Map<string, number>): Map<number, string[]> {
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
    group.sort((a, b) => a.localeCompare(b));
  }
  return byLayer;
}

/** Assign x/y positions and produce sorted node list. */
function assignPositions(
  byLayer: Map<number, string[]>,
  spacingX: number,
  spacingY: number,
): DagNode[] {
  const nodes: DagNode[] = [];
  for (const [l, ids] of byLayer) {
    ids.forEach((id, index) => {
      nodes.push({ id, label: id, x: l * spacingX, y: index * spacingY, layer: l });
    });
  }
  nodes.sort((a, b) => a.layer - b.layer || a.y - b.y || a.id.localeCompare(b.id));
  return nodes;
}

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

  const { stepIds, edges } = buildEdges(graph);
  const inDegree = computeInDegrees(stepIds, edges);
  const adjList = buildAdjList(stepIds, edges);
  const layer = computeLayers(stepIds, inDegree, adjList);
  const byLayer = groupByLayer(layer);
  const nodes = assignPositions(byLayer, spacingX, spacingY);

  return { nodes, edges };
}
