import { describe, it, expect } from "vitest";
import {
  serializeGraph,
  deserializeGraph,
  serializeRunPlan,
  deserializeRunPlan,
  computeGraphId,
  computeRunPlanId,
  ValidationError,
  SerializationError,
} from "../index.js";
import { makeSampleGraph, makeSampleRunPlan } from "./helpers/fixtures.js";

describe("serializeGraph → deserializeGraph round-trip", () => {
  it("round-trips a Definition Graph", () => {
    const graph = makeSampleGraph();
    const json = serializeGraph(graph);
    const parsed = deserializeGraph(json);
    expect(parsed.apiVersion).toBe("sverka.dev/v1graph");
    expect(parsed.graph.project.id).toBe(graph.project.id);
    expect(parsed.graph.project.pipelines.length).toBe(graph.project.pipelines.length);
  });

  it("produces an id matching computeGraphId", () => {
    const graph = makeSampleGraph();
    const json = serializeGraph(graph);
    const parsed = deserializeGraph(json);
    expect(parsed.id).toBe(computeGraphId(graph));
  });

  it("produces canonical JSON (sorted keys, compact)", () => {
    const graph = makeSampleGraph();
    const json = serializeGraph(graph);
    // No whitespace between key and value.
    expect(json).not.toMatch(/:\s/);
    // Keys are sorted at the top level.
    const firstBrace = json.indexOf("{");
    const apiVersionPos = json.indexOf('"apiVersion"');
    const createdAtPos = json.indexOf('"createdAt"');
    const graphPos = json.indexOf('"graph"');
    const idPos = json.indexOf('"id"');
    expect(apiVersionPos).toBeGreaterThan(firstBrace);
    expect(createdAtPos).toBeGreaterThan(apiVersionPos);
    expect(graphPos).toBeGreaterThan(createdAtPos);
    expect(idPos).toBeGreaterThan(graphPos);
  });
});

describe("deserializeGraph error handling", () => {
  it("rejects malformed JSON → SerializationError", () => {
    expect(() => deserializeGraph("{ not json")).toThrow(SerializationError);
  });

  it("rejects wrong apiVersion → ValidationError", () => {
    const graph = makeSampleGraph();
    const json = serializeGraph(graph).replace("sverka.dev/v1graph", "sverka.dev/v0");
    expect(() => deserializeGraph(json)).toThrow(ValidationError);
  });

  it("rejects missing id → ValidationError", () => {
    const graph = makeSampleGraph();
    const obj = JSON.parse(serializeGraph(graph));
    delete obj.id;
    expect(() => deserializeGraph(JSON.stringify(obj))).toThrow(ValidationError);
  });

  it("rejects missing graph → ValidationError", () => {
    const graph = makeSampleGraph();
    const obj = JSON.parse(serializeGraph(graph));
    delete obj.graph;
    expect(() => deserializeGraph(JSON.stringify(obj))).toThrow(ValidationError);
  });

  it("rejects invalid graph structure → ValidationError", () => {
    const json = JSON.stringify({
      apiVersion: "sverka.dev/v1graph",
      id: "graph-test",
      createdAt: "2026-08-13T00:00:00.000Z",
      graph: { project: { id: 123 } },
    });
    expect(() => deserializeGraph(json)).toThrow(ValidationError);
  });

  it("rejects graph with cycles → ValidationError (semantic)", () => {
    const json = JSON.stringify({
      apiVersion: "sverka.dev/v1graph",
      id: "graph-test",
      createdAt: "2026-08-13T00:00:00.000Z",
      graph: {
        project: {
          id: "myproj",
          pipelines: [
            {
              id: "ci",
              inputs: [],
              entries: [],
              outputs: [],
              steps: [
                {
                  id: "ci/a",
                  runtime: {},
                  operations: [{ kind: "shell", command: "echo a" }],
                  inputs: [],
                  outputs: [],
                  dependencies: [{ kind: "control", producer: "ci/b" }],
                },
                {
                  id: "ci/b",
                  runtime: {},
                  operations: [{ kind: "shell", command: "echo b" }],
                  inputs: [],
                  outputs: [],
                  dependencies: [{ kind: "control", producer: "ci/a" }],
                },
              ],
            },
          ],
        },
      },
    });
    expect(() => deserializeGraph(json)).toThrow(ValidationError);
  });
});

describe("serializeRunPlan → deserializeRunPlan round-trip", () => {
  it("round-trips a Run Plan", () => {
    const plan = makeSampleRunPlan(makeSampleGraph());
    const json = serializeRunPlan(plan);
    const parsed = deserializeRunPlan(json);
    expect(parsed.apiVersion).toBe("sverka.dev/v1run");
    expect(parsed.graphId).toBe(plan.graphId);
    expect(parsed.entry.id).toBe(plan.entry.id);
    expect(parsed.inputs.env).toBe("production");
    expect(parsed.steps.length).toBe(plan.steps.length);
  });

  it("produces an id matching computeRunPlanId", () => {
    const plan = makeSampleRunPlan(makeSampleGraph());
    const { id: _id, createdAt: _c, ...body } = plan;
    const json = serializeRunPlan(plan);
    const parsed = deserializeRunPlan(json);
    expect(parsed.id).toBe(computeRunPlanId(body));
  });
});

describe("deserializeRunPlan error handling", () => {
  it("rejects malformed JSON → SerializationError", () => {
    expect(() => deserializeRunPlan("{ not json")).toThrow(SerializationError);
  });

  it("rejects wrong apiVersion → ValidationError", () => {
    const plan = makeSampleRunPlan(makeSampleGraph());
    const json = serializeRunPlan(plan).replace("sverka.dev/v1run", "sverka.dev/v0");
    expect(() => deserializeRunPlan(json)).toThrow(ValidationError);
  });

  it("rejects missing entry → ValidationError", () => {
    const plan = makeSampleRunPlan(makeSampleGraph());
    const obj = JSON.parse(serializeRunPlan(plan));
    delete obj.entry;
    expect(() => deserializeRunPlan(JSON.stringify(obj))).toThrow(ValidationError);
  });

  it("rejects missing steps → ValidationError", () => {
    const plan = makeSampleRunPlan(makeSampleGraph());
    const obj = JSON.parse(serializeRunPlan(plan));
    delete obj.steps;
    expect(() => deserializeRunPlan(JSON.stringify(obj))).toThrow(ValidationError);
  });

  it("rejects invalid trigger kind → ValidationError", () => {
    const plan = makeSampleRunPlan(makeSampleGraph());
    const obj = JSON.parse(serializeRunPlan(plan));
    obj.entry.trigger.kind = "unknown";
    expect(() => deserializeRunPlan(JSON.stringify(obj))).toThrow(ValidationError);
  });
});
