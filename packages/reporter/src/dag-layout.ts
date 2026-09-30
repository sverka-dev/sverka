// @sverka/reporter — DAG layout (pure). Spec 44, 51.
//
// Positions and edge routing come from dagre (Sugiyama layout) —
// computed at report-generation time, so the emitted HTML stays a
// fully self-contained static SVG. `layer` keeps the old longest-path
// semantics (rank distance from a root) for consumers/tests.

import { graphlib, layout as dagreLayout } from "@dagrejs/dagre";
import type { DefinitionGraph } from "@sverka/workflow";
import type {
  DagNode,
  DagEdge,
  DagLayoutResult,
  DagLayoutOptions,
} from "./types.js";

const NODE_W = 190;
const NODE_H = 44;

/** Collect all steps and build edges from dependencies. */
function buildEdges(graph: DefinitionGraph): {
  steps: readonly {
    id: string;
    dependencies: readonly { producer: string; kind?: string }[];
  }[];
  stepIds: Set<string>;
  edges: DagEdge[];
} {
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

/** Adjacency + in-degree index over the edges. */
function indexEdges(
  stepIds: Set<string>,
  edges: readonly DagEdge[],
): { children: Map<string, string[]>; inDegree: Map<string, number> } {
  const children = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const id of stepIds) {
    children.set(id, []);
    inDegree.set(id, 0);
  }
  for (const e of edges) {
    children.get(e.source)?.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }
  return { children, inDegree };
}

/** Layer-0 init: zero layer everywhere, roots queued sorted. */
function initLayers(inDegree: Map<string, number>): {
  layer: Map<string, number>;
  queue: string[];
} {
  const layer = new Map<string, number>();
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    layer.set(id, 0);
    if (deg === 0) queue.push(id);
  }
  queue.sort((a, b) => a.localeCompare(b, "en"));
  return { layer, queue };
}

/** Longest-path layer of each node (0 = root), via Kahn's order. */
function computeLayers(
  stepIds: Set<string>,
  edges: readonly DagEdge[],
): Map<string, number> {
  const { children, inDegree } = indexEdges(stepIds, edges);
  const { layer, queue } = initLayers(inDegree);
  while (queue.length > 0) {
    const id = queue.shift()!;
    const l = layer.get(id) ?? 0;
    for (const next of children.get(id) ?? []) {
      if (l + 1 > (layer.get(next) ?? 0)) layer.set(next, l + 1);
      const deg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, deg);
      if (deg === 0) {
        queue.push(next);
        queue.sort((a, b) => a.localeCompare(b, "en"));
      }
    }
  }
  return layer;
}

/**
 * Compute the layout for a DefinitionGraph via dagre (left-to-right
 * ranks, routed edge points). Deterministic for the same input.
 */
export function layoutDag(
  graph: DefinitionGraph,
  options?: DagLayoutOptions,
): DagLayoutResult {
  const { stepIds, edges } = buildEdges(graph);
  if (stepIds.size === 0) return { nodes: [], edges: [] };

  const g = new graphlib.Graph();
  g.setGraph({
    rankdir: options?.direction ?? "LR",
    nodesep: options?.nodeSpacingY ?? 26,
    ranksep: options?.nodeSpacingX ?? 110,
    marginx: 0,
    marginy: 0,
  });
  g.setDefaultEdgeLabel(() => ({}));
  for (const id of stepIds) {
    g.setNode(id, { width: NODE_W, height: NODE_H });
  }
  // Dagre collapses parallel edges between the same pair — our edges
  // list keeps every dependency kind, so dedupe what we hand it.
  const seen = new Set<string>();
  for (const e of edges) {
    const key = `${e.source}${e.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    g.setEdge(e.source, e.target);
  }
  dagreLayout(g);

  const layer = computeLayers(stepIds, edges);
  const nodes: DagNode[] = g.nodes().map((id) => {
    const n = g.node(id);
    return {
      id,
      label: id,
      x: n.x - n.width / 2,
      y: n.y - n.height / 2,
      width: n.width,
      height: n.height,
      layer: layer.get(id) ?? 0,
    };
  });
  nodes.sort(
    (a, b) => a.layer - b.layer || a.y - b.y || a.id.localeCompare(b.id, "en"),
  );

  const routed = edges.map((e) => {
    const de = g.edge({ v: e.source, w: e.target });
    return {
      ...e,
      points: de?.points?.map((p: { x: number; y: number }) => ({
        x: p.x,
        y: p.y,
      })),
    };
  });

  return { nodes, edges: routed };
}
